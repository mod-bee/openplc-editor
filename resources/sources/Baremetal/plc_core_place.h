// Where an IEC task runs: the per-task Core setting (the project's
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
#ifndef PLC_CORE_PLACE_H
#define PLC_CORE_PLACE_H

#define PLC_CORE_AUTO (-1)

static inline int plc_core_place(int wanted, int cores, int plc_core)
{
    return (wanted >= 0 && wanted < cores) ? wanted : plc_core;
}

#endif
