import fs from "fs";
import { VM, type VMOptions } from "../../src/vm";

/**
 * Check if hardware virtualization is available.
 * On Linux, this checks for KVM. On macOS, HVF is always available.
 * Returns false for other platforms or when acceleration is unavailable.
 */
export function hasHardwareAccel(): boolean {
  if (process.platform === "darwin") {
    return true; // HVF is always available on macOS
  }
  if (process.platform === "linux") {
    try {
      fs.accessSync("/dev/kvm", fs.constants.R_OK | fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Whether VM tests should be skipped (no hardware acceleration available).
 * Can be overridden by setting GONDOLIN_FORCE_VM_TESTS=1.
 */
export function shouldSkipVmTests(): boolean {
  if (process.env.GONDOLIN_FORCE_VM_TESTS === "1") {
    return false;
  }
  return !hasHardwareAccel();
}

class Semaphore {
  private queue: Array<() => void> = [];

  constructor(private count: number) {}

  async acquire(): Promise<void> {
    if (this.count > 0) {
      this.count -= 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
      return;
    }
    this.count += 1;
  }
}

type VmEntry = {
  vm: VM;
  semaphore: Semaphore;
};

const pool = new Map<string, VmEntry>();
const pending = new Map<string, Promise<VmEntry>>();

async function getEntry(key: string, options: VMOptions): Promise<VmEntry> {
  const existing = pool.get(key);
  if (existing) {
    return existing;
  }

  const inFlight = pending.get(key);
  if (inFlight) {
    return inFlight;
  }

  const created = (async () => {
    try {
      const vm = await VM.create(options);
      const entry = { vm, semaphore: new Semaphore(1) };
      pool.set(key, entry);
      return entry;
    } finally {
      pending.delete(key);
    }
  })();

  pending.set(key, created);
  return created;
}

export async function withVm<T>(
  key: string,
  options: VMOptions,
  fn: (vm: VM) => Promise<T>
): Promise<T> {
  const entry = await getEntry(key, options);
  await entry.semaphore.acquire();
  try {
    return await fn(entry.vm);
  } finally {
    entry.semaphore.release();
  }
}

export async function closeVm(key: string): Promise<void> {
  const entry = pool.get(key);
  if (!entry) {
    pending.delete(key);
    return;
  }
  pool.delete(key);
  pending.delete(key);
  await entry.vm.stop();
}

export async function closeAllVms(): Promise<void> {
  const entries = Array.from(pool.values());
  pool.clear();
  pending.clear();
  await Promise.all(entries.map(({ vm }) => vm.stop()));
}
