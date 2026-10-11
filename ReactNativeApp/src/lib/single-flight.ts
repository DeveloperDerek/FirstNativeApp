type Run<T> = { key: string; job: () => Promise<T>; done: Promise<T> };

/**
 * Runs one job at a time (step-tracker-step-refresh.txt, part B). A call
 * while a job runs joins it and gets the same answer. A call with a
 * different key (e.g. sharing was just turned on) waits for the running
 * job, then runs once more; calls made meanwhile join that extra run,
 * which uses the latest key and job.
 */
export function singleFlight<T>() {
  let running: { key: string; done: Promise<T> } | null = null;
  let next: Run<T> | null = null;

  function start(key: string, job: () => Promise<T>): Promise<T> {
    const done: Promise<T> = Promise.resolve()
      .then(job)
      .finally(() => {
        if (running?.done === done) running = null;
      });
    running = { key, done };
    return done;
  }

  return function run(key: string, job: () => Promise<T>): Promise<T> {
    if (next) {
      next.key = key;
      next.job = job;
      return next.done;
    }
    if (!running) return start(key, job);
    if (running.key === key) return running.done;

    const queued = { key, job } as Run<T>;
    queued.done = running.done
      .catch(() => {})
      .then(() => {
        next = null;
        return start(queued.key, queued.job);
      });
    next = queued;
    return queued.done;
  };
}
