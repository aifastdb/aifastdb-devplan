export namespace GammaDomain {
  export interface Runner {
    run(): string;
  }

  export function helper(): string {
    return 'gamma';
  }

  export class BaseRunner {
    run(): string {
      return helper();
    }
  }

  export class ConcreteRunner extends BaseRunner implements Runner {
    run(): string {
      return helper();
    }
  }
}
