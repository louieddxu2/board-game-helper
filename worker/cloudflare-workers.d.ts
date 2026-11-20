// Minimal declaration of the Workers runtime module this project uses. The full
// @cloudflare/workers-types globals conflict with the DOM types the app needs.
declare module 'cloudflare:workers' {
  export abstract class WorkerEntrypoint<Env = unknown> {
    protected ctx: unknown;
    protected env: Env;
    constructor(ctx: unknown, env: Env);
  }
}
