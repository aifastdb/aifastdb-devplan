import { betaTask } from '../beta/c';

export interface AlphaConfig {
  mode: string;
}

export enum AlphaMode {
  Fast = 'fast',
}

export class AlphaService {
  run(): string {
    return alphaMain();
  }
}

export class AdvancedAlphaService extends AlphaService implements AlphaConfig {
  mode = AlphaMode.Fast;

  runAdvanced(): string {
    return alphaMain();
  }
}

export function alphaMain(): string {
  return betaTask();
}

export const alphaHelper = (): string => alphaMain();
