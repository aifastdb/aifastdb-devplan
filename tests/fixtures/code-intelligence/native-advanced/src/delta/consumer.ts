import { bootstrapGamma } from '../gamma/entry';
import runDefaultGamma from '../gamma/default-helper';
import { helper as gammaHelper } from '../gamma/models';
import { helper as gammaHelperReexport } from '../gamma/reexport';

export const consumeGamma = (): string => bootstrapGamma();

export function consumeGammaAlias(): string {
  return gammaHelper();
}

export function consumeGammaReexport(): string {
  return gammaHelperReexport();
}

export function consumeGammaDefault(): string {
  return runDefaultGamma();
}
