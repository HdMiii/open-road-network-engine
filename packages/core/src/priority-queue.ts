export interface QueueItem {
  id: number;
  priority: number;
}

export class MinPriorityQueue {
  #heap: QueueItem[] = [];

  get size(): number {
    return this.#heap.length;
  }

  push(id: number, priority: number): void {
    this.#heap.push({ id, priority });
    this.#bubbleUp(this.#heap.length - 1);
  }

  pop(): QueueItem | undefined {
    if (this.#heap.length === 0) return undefined;
    const top = this.#heap[0];
    const last = this.#heap.pop();
    if (last && this.#heap.length > 0) {
      this.#heap[0] = last;
      this.#sinkDown(0);
    }
    return top;
  }

  #bubbleUp(index: number): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!this.#before(this.#heap[index], this.#heap[parent])) return;
      this.#swap(parent, index);
      index = parent;
    }
  }

  #sinkDown(index: number): void {
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < this.#heap.length && this.#before(this.#heap[left], this.#heap[smallest])) {
        smallest = left;
      }
      if (right < this.#heap.length && this.#before(this.#heap[right], this.#heap[smallest])) {
        smallest = right;
      }
      if (smallest === index) return;
      this.#swap(index, smallest);
      index = smallest;
    }
  }

  // Order by priority, breaking ties by ascending id so equal-priority items pop
  // deterministically (lowest id first). This mirrors the ascending-index order of
  // the earlier linear-scan Dijkstra and keeps shortest-path results reproducible
  // when zero-weight edges create equal-distance ties.
  #before(a: QueueItem, b: QueueItem): boolean {
    return a.priority < b.priority || (a.priority === b.priority && a.id < b.id);
  }

  #swap(a: number, b: number): void {
    const temp = this.#heap[a];
    this.#heap[a] = this.#heap[b];
    this.#heap[b] = temp;
  }
}

