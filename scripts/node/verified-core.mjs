// Install the exact Core release used by the node installer into a staging
// directory. No services, dependencies, configuration or chain data are created.
import path from 'node:path';
import { parseArgs } from 'node:util';
import { installCoreRelease } from '../../src/node/service.mjs';
const { values } = parseArgs({ options: { directory: { type: 'string' } } });
if (!values.directory || !path.isAbsolute(values.directory)) throw Error('Provide --directory /absolute/staging/directory');
const result = await installCoreRelease({ network: 'signet' }, { directory: values.directory });
console.log(JSON.stringify({ architecture: process.arch, version: result.version, binary: result.binary, verification: result.verification }, null, 2));
