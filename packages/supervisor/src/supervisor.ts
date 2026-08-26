import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

import type {
  LogStream,
  ProcessCommand,
  ServiceLogEntry,
  ServiceName,
  ServiceState,
  ServiceStatus,
} from "./types";
import { redactDiagnostic } from "./redaction";

export interface ServiceSupervisorEvents {
  log: [ServiceLogEntry];
  status: [ServiceStatus];
}

interface ManagedService {
  child: ChildProcess | null;
  command: ProcessCommand;
  status: ServiceStatus;
  stopping: boolean;
}

export class ServiceSupervisor extends EventEmitter {
  private nextLogId = 1;
  private readonly logs: ServiceLogEntry[] = [];
  private readonly services = new Map<ServiceName, ManagedService>();

  constructor(private readonly maxLogEntries = 500) {
    super();
  }

  override on<EventName extends keyof ServiceSupervisorEvents>(
    eventName: EventName,
    listener: (...args: ServiceSupervisorEvents[EventName]) => void,
  ): this {
    return super.on(eventName, listener);
  }

  override emit<EventName extends keyof ServiceSupervisorEvents>(
    eventName: EventName,
    ...args: ServiceSupervisorEvents[EventName]
  ): boolean {
    return super.emit(eventName, ...args);
  }

  start(command: ProcessCommand): void {
    const current = this.services.get(command.name);

    if (current?.child !== null && current?.child !== undefined) {
      throw new Error(`Greenroom ${command.name} service is already running`);
    }

    const startedAt = new Date().toISOString();
    const status: ServiceStatus = {
      name: command.name,
      state: "starting",
      url: command.url,
      pid: null,
      startedAt,
      stoppedAt: null,
      exitCode: null,
      signal: null,
      message: null,
    };
    const service: ManagedService = {
      child: null,
      command,
      status,
      stopping: false,
    };

    this.services.set(command.name, service);
    this.updateStatus(command.name, status);
    this.log(command.name, "system", `Starting Greenroom ${command.name} service`);

    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      env: mergeProcessEnv(command.env),
      stdio: ["ignore", "pipe", "pipe"],
    });

    service.child = child;
    this.updateStatus(command.name, {
      ...service.status,
      pid: child.pid ?? null,
    });

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => this.logChunk(command.name, "stdout", chunk));
    child.stderr?.on("data", (chunk: string) => this.logChunk(command.name, "stderr", chunk));
    child.on("error", (error) => {
      this.updateStatus(command.name, {
        ...service.status,
        state: "failed",
        stoppedAt: new Date().toISOString(),
        message: error.message,
      });
      this.log(
        command.name,
        "system",
        `Greenroom ${command.name} service failed: ${error.message}`,
      );
    });
    child.on("exit", (code, signal) => {
      service.child = null;
      const expectedStop = service.stopping;
      const state: ServiceState = expectedStop ? "stopped" : code === 0 ? "exited" : "failed";
      const message = expectedStop
        ? null
        : `Greenroom ${command.name} service exited${code === null ? "" : ` with code ${code}`}`;

      this.updateStatus(command.name, {
        ...service.status,
        state,
        stoppedAt: new Date().toISOString(),
        exitCode: code,
        signal,
        message,
      });

      if (message !== null) {
        this.log(command.name, "system", message);
      }
    });
  }

  markRunning(name: ServiceName, url: string): void {
    const service = this.requireService(name);
    this.updateStatus(name, {
      ...service.status,
      state: "running",
      url,
      message: null,
    });
  }

  markFailed(name: ServiceName, message: string): void {
    const service = this.services.get(name);
    const status = service?.status ?? createInitialStatus(name);

    this.updateStatus(name, {
      ...status,
      state: "failed",
      stoppedAt: new Date().toISOString(),
      message,
    });
    this.log(name, "system", message);
  }

  getStatuses(): ServiceStatus[] {
    return Array.from(this.services.values()).map((service) => ({ ...service.status }));
  }

  getLogs(): ServiceLogEntry[] {
    return this.logs.map((entry) => ({ ...entry }));
  }

  async stopAll(): Promise<void> {
    const services = Array.from(this.services.values()).reverse();
    await Promise.all(services.map((service) => this.stopService(service)));
  }

  private async stopService(service: ManagedService): Promise<void> {
    const child = service.child;

    if (child === null) {
      if (service.status.state !== "stopped") {
        this.updateStatus(service.command.name, {
          ...service.status,
          state: "stopped",
          stoppedAt: service.status.stoppedAt ?? new Date().toISOString(),
        });
      }
      return;
    }

    service.stopping = true;
    this.updateStatus(service.command.name, {
      ...service.status,
      state: "stopping",
      message: null,
    });
    this.log(service.command.name, "system", `Stopping Greenroom ${service.command.name} service`);

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (service.child !== null) {
          service.child.kill("SIGKILL");
        }
      }, 5_000);

      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }

  private requireService(name: ServiceName): ManagedService {
    const service = this.services.get(name);

    if (service === undefined) {
      throw new Error(`Greenroom ${name} service has not been started`);
    }

    return service;
  }

  private logChunk(name: ServiceName, stream: LogStream, chunk: string): void {
    for (const line of chunk.split(/\r?\n/u)) {
      const message = line.trimEnd();

      if (message.length > 0) {
        this.log(name, stream, message);
      }
    }
  }

  private log(name: ServiceName, stream: LogStream, message: string): void {
    const redactedMessage = this.redactMessage(name, message);
    const entry: ServiceLogEntry = {
      id: this.nextLogId,
      service: name,
      stream,
      message: redactedMessage,
      timestamp: new Date().toISOString(),
    };

    this.nextLogId += 1;
    this.logs.push(entry);

    while (this.logs.length > this.maxLogEntries) {
      this.logs.shift();
    }

    this.emit("log", entry);
  }

  private updateStatus(name: ServiceName, status: ServiceStatus): void {
    const service = this.services.get(name);
    const nextStatus: ServiceStatus = {
      ...status,
      message: status.message === null ? null : this.redactMessage(name, status.message),
    };

    if (service !== undefined) {
      service.status = nextStatus;
    }

    this.emit("status", { ...nextStatus });
  }

  private redactMessage(name: ServiceName, message: string): string {
    const env = this.services.get(name)?.command.env;
    return env === undefined ? redactDiagnostic(message) : redactDiagnostic(message, { env });
  }
}

function createInitialStatus(name: ServiceName): ServiceStatus {
  return {
    name,
    state: "idle",
    url: null,
    pid: null,
    startedAt: null,
    stoppedAt: null,
    exitCode: null,
    signal: null,
    message: null,
  };
}

function mergeProcessEnv(env: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...process.env };

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  }

  return merged;
}
