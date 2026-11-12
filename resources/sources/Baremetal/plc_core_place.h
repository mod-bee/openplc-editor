// Where and how an IEC task runs: the per-task Core setting (the project's
// `TASK t(...) {CORE := n};`, an IEC 61131-3 §6.2 pragma, read through
// strucpp_task_core()). The same rule on every bare-metal target; the OS layer
// (plc_os.cpp) only says how many cores there are and pins a task to one.
//
//   wanted     the task's core, or PLC_CORE_AUTO (-1) for Auto
//   cores      plc_os_core_count()
//   plc_core   the core setup() runs on: Auto, as before the setting existed
//
// A core the target lacks is placed on Auto; the task statistics carry both the
// core set and the core used, so the editor shows it. Runtime v4 follows the
// same rule with the machine's CPUs (plc_state_manager.cpp).
//
// The same file holds the task's two other settings, the same way:
//
// Stack (`{STACK := n}`, strucpp_task_stack(), 0 = Default): the size asked
// where it is within the target's bounds (plc_rtos.h's
// OPENPLC_RTOS_TASK_STACK_MIN/MAX), else the default, OPENPLC_RTOS_WORK_STACK.
//
// Stop PLC if stuck (`{STOP_ON_STUCK := FALSE}`, strucpp_task_stop_on_stuck(),
// default TRUE): a task past the stuck limit (OPENPLC_RTOS_STUCK_PERIODS of its
// periods in one scan, or a first scan past its timeout) stops the PLC, as
// always; set not to, it is reported (status, statistics, overruns) and the PLC
// and the other tasks keep running. Runtime v4 follows the same rules
// (task_policy.c).
#ifndef PLC_CORE_PLACE_H
#define PLC_CORE_PLACE_H

#include <stdbool.h>
#include <stdint.h>

#define PLC_CORE_AUTO (-1)

static inline int plc_core_place(int wanted, int cores, int plc_core)
{
    return (wanted >= 0 && wanted < cores) ? wanted : plc_core;
}

static inline uint32_t plc_task_stack(uint32_t wanted, uint32_t def, uint32_t min, uint32_t max)
{
    return (wanted >= min && wanted <= max) ? wanted : def;
}

// What the dispatcher does with a task it finds still in one scan.
#define PLC_STUCK_NONE   0   // not past the limit
#define PLC_STUCK_STOP   1   // stop the PLC (ERROR), as always
#define PLC_STUCK_REPORT 2   // report it; the PLC and the other tasks keep running

static inline int plc_task_stuck_action(bool past_limit, bool stop_on_stuck)
{
    return !past_limit ? PLC_STUCK_NONE : stop_on_stuck ? PLC_STUCK_STOP : PLC_STUCK_REPORT;
}

// On a stop, a task set not to stop the PLC when stuck (a communications task in
// a Wi-Fi / TCP connect) may finish its scan until this long after the stop, when
// that is later than its own stuck limit, so the stop ends as a normal stop.
// Runtime v4: PLC_STOP_WAIT_KEEP_RUNNING_MS (task_policy.h).
#define PLC_STOP_WAIT_KEEP_RUNNING_US 10000000LL

// Until when a stop lets a task's in-flight scan run (any one time unit).
static inline int64_t plc_task_stop_deadline(int64_t release, int64_t scan_limit, int64_t stop_at,
                                             int64_t keep_running, bool stop_on_stuck)
{
    const int64_t own = release + scan_limit;
    return (stop_on_stuck || stop_at + keep_running <= own) ? own : stop_at + keep_running;
}

// Recovery after a fault ({RESTART_ON_FAULT := n}; arduino_runtime_glue.cpp).
// A task a runtime error ended is resumed; a PLC stopped by a stuck task, a task
// still stuck, or a safe-mode boot restarts the board into RUN. At most
// PLC_RECOVER_LIMIT recoveries until PLC_RECOVER_CLEAR_US of running without one.
#define PLC_RECOVER_NONE    0
#define PLC_RECOVER_RESUME  1
#define PLC_RECOVER_RESTART 2
#define PLC_RECOVER_LIMIT   3u
#define PLC_RECOVER_CLEAR_US (24LL * 3600LL * 1000000LL)

// Whether a new fault's recovery takes the place of the one pending: a restart
// overrides a resume, never the other way, and a task without the setting
// (delay 0) changes nothing.
static inline bool plc_recover_replaces(uint8_t pending, uint8_t wanted, uint32_t delay_s)
{
    return delay_s != 0 && wanted != PLC_RECOVER_NONE && wanted > pending;
}

// What a recovery that has come due does: NONE when the count is used up, or
// when it was for a task stuck in one scan that has finished it since.
static inline uint8_t plc_recover_action(uint8_t pending, uint32_t done, bool was_stuck, bool still_stuck)
{
    if (pending == PLC_RECOVER_NONE || done >= PLC_RECOVER_LIMIT) return PLC_RECOVER_NONE;
    if (was_stuck && !still_stuck) return PLC_RECOVER_NONE;
    return pending;
}

// Whether the count starts again: a whole PLC_RECOVER_CLEAR_US since the last
// recovery (or the start).
static inline bool plc_recover_clears(int64_t now_us, int64_t since_us)
{
    return now_us - since_us >= PLC_RECOVER_CLEAR_US;
}

#endif
