/**
 * 极简异步队列：多个并发任务 push，一个消费者用 for await 按到达顺序读取。
 */
export function channel<T>() {
  const queue: T[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  const notify = () => {
    wake?.();
    wake = null;
  };

  return {
    push(value: T) {
      queue.push(value);
      notify();
    },
    close() {
      closed = true;
      notify();
    },
    async *[Symbol.asyncIterator](): AsyncGenerator<T> {
      while (true) {
        while (queue.length) yield queue.shift()!;
        if (closed) return;
        await new Promise<void>((resolve) => (wake = resolve));
      }
    },
  };
}
