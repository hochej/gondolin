import net from "net";
import cbor from "cbor";

const MAX_FRAME = 4 * 1024 * 1024;

type ExecOutput = {
  v: number;
  t: "exec_output";
  id: number;
  p: {
    stream: "stdout" | "stderr";
    data: Buffer;
  };
};

type ExecResponse = {
  v: number;
  t: "exec_response";
  id: number;
  p: {
    exit_code: number;
    signal?: number;
  };
};

type ErrorResponse = {
  v: number;
  t: "error";
  id: number;
  p: {
    code: string;
    message: string;
  };
};

type IncomingMessage = ExecOutput | ExecResponse | ErrorResponse;

type Args = {
  sock?: string;
  cmd?: string;
  argv: string[];
  env: string[];
  cwd?: string;
  id: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { argv: [], env: [], id: 1 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--sock":
        args.sock = argv[++i];
        break;
      case "--cmd":
        args.cmd = argv[++i];
        break;
      case "--arg":
        args.argv.push(argv[++i]);
        break;
      case "--env":
        args.env.push(argv[++i]);
        break;
      case "--cwd":
        args.cwd = argv[++i];
        break;
      case "--id":
        args.id = Number(argv[++i]);
        break;
      case "--help":
      case "-h":
        usage();
        process.exit(0);
      default:
        console.error(`Unknown argument: ${arg}`);
        usage();
        process.exit(1);
    }
  }
  return args;
}

function usage() {
  console.log("Usage: node dist/exec.js --sock PATH --cmd CMD [--arg ARG] [--env KEY=VALUE] [--cwd PATH]");
}

class FrameReader {
  private buffer = Buffer.alloc(0);
  private expectedLength: number | null = null;

  push(chunk: Buffer, onFrame: (frame: Buffer) => void) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (true) {
      if (this.expectedLength === null) {
        if (this.buffer.length < 4) return;
        this.expectedLength = this.buffer.readUInt32BE(0);
        this.buffer = this.buffer.slice(4);
        if (this.expectedLength > MAX_FRAME) {
          throw new Error(`Frame too large: ${this.expectedLength}`);
        }
      }

      if (this.buffer.length < this.expectedLength) return;

      const frame = this.buffer.slice(0, this.expectedLength);
      this.buffer = this.buffer.slice(this.expectedLength);
      this.expectedLength = null;
      onFrame(frame);
    }
  }
}

function normalize(value: unknown): unknown {
  if (value instanceof Map) {
    const obj: Record<string, unknown> = {};
    for (const [key, entry] of value.entries()) {
      obj[String(key)] = normalize(entry);
    }
    return obj;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalize(entry));
  }
  if (value instanceof Uint8Array && !Buffer.isBuffer(value)) {
    return Buffer.from(value);
  }
  return value;
}

function buildExecRequest(args: Args) {
  const payload: Record<string, unknown> = {
    cmd: args.cmd,
  };

  if (args.argv.length > 0) payload.argv = args.argv;
  if (args.env.length > 0) payload.env = args.env;
  if (args.cwd) payload.cwd = args.cwd;

  return {
    v: 1,
    t: "exec_request",
    id: args.id,
    p: payload,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.sock || !args.cmd) {
    usage();
    process.exit(1);
  }

  const socket = net.createConnection({ path: args.sock });
  const reader = new FrameReader();

  socket.on("connect", () => {
    console.log(`connected to ${args.sock}`);
    const message = buildExecRequest(args);
    const payload = cbor.encode(message);
    const header = Buffer.alloc(4);
    header.writeUInt32BE(payload.length, 0);
    socket.write(Buffer.concat([header, payload]));
  });

  socket.on("data", (chunk) => {
    reader.push(chunk, (frame) => {
      const raw = cbor.decodeFirstSync(frame);
      const message = normalize(raw) as IncomingMessage;
      if (message.t === "exec_output") {
        const data = Buffer.isBuffer(message.p.data)
          ? message.p.data
          : Buffer.from(message.p.data as unknown as Uint8Array);
        if (message.p.stream === "stdout") {
          process.stdout.write(data);
        } else {
          process.stderr.write(data);
        }
      } else if (message.t === "exec_response") {
        const code = message.p.exit_code ?? 1;
        const signal = message.p.signal;
        if (signal !== undefined) {
          console.error(`process exited due to signal ${signal}`);
        }
        socket.end();
        process.exit(code);
      } else if (message.t === "error") {
        console.error(`error ${message.p.code}: ${message.p.message}`);
        socket.end();
        process.exit(1);
      }
    });
  });

  socket.on("error", (err) => {
    console.error(`socket error: ${err.message}`);
    process.exit(1);
  });

  socket.on("end", () => {
    process.exit(1);
  });
}

main();
