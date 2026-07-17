import { exoAdapter } from './exo.mjs';
import { graphwaguAdapter } from './graphwagu.mjs';
import { sigmaAdapter } from './sigma.mjs';

export const ADAPTERS = Object.freeze({ exo: exoAdapter, sigma: sigmaAdapter, graphwagu: graphwaguAdapter });
