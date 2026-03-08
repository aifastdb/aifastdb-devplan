import { GammaDomain } from './models';

export function bootstrapGamma(): string {
  const runner = new GammaDomain.ConcreteRunner();
  return runner.run();
}
