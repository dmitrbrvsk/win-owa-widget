// Inspect the packaged executables, rather than trusting the builder configuration alone.
import { getCurrentFuseWire, FuseV1Options } from '@electron/fuses';

const expected = {
  RunAsNode: false,
  EnableCookieEncryption: true,
  EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false,
  EnableEmbeddedAsarIntegrityValidation: true,
  OnlyLoadAppFromAsar: true,
  GrantFileProtocolExtraPrivileges: false,
};

try {
  if (process.argv.length < 3) throw new Error('Pass the paths of the packaged Electron executables');
  for (const path of process.argv.slice(2)) {
    const wire = await getCurrentFuseWire(path);
    for (const [name, enabled] of Object.entries(expected)) {
      // FuseState is not exported at the package root: the documented v1 wire uses ASCII 0/1.
      const required = enabled ? '1'.charCodeAt(0) : '0'.charCodeAt(0);
      if (wire[FuseV1Options[name]] !== required) throw new Error(`${path}: ${name} must be ${enabled ? 'enabled' : 'disabled'}`);
    }
    console.log(`FUSES ok ${path}: file privileges disabled; ASAR integrity and runtime fuses verified`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
