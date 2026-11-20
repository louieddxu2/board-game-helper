// Node stand-in for the Workers runtime module, used by Vitest and Node
// bundles of the Worker. Production builds resolve the real module.
export abstract class WorkerEntrypoint<Env = unknown> {
  protected ctx: unknown;
  protected env: Env;
  constructor(ctx: unknown, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
