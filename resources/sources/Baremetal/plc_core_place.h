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

#endif
