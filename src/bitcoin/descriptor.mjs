// Output-descriptor checksum, per Bitcoin Core's implementation
// (src/script/descriptor.cpp DescriptorChecksum). Lets the descriptors bitcode
// emits be pasted straight into `importdescriptors`.

const INPUT_CHARSET =
  "0123456789()[],'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#\"\\ ";
const CHECKSUM_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GEN = [0xf5dee51989n, 0xa9fdca3312n, 0x1bab10e32dn, 0x3706b1677an, 0x644d626ffdn];

function polymod(c, val) {
  const top = c >> 35n;
  c = ((c & 0x7ffffffffn) << 5n) ^ val;
  for (let i = 0; i < 5; i++) if ((top >> BigInt(i)) & 1n) c ^= GEN[i];
  return c;
}

export function descriptorChecksum(desc) {
  let c = 1n;
  let cls = 0n;
  let clscount = 0;
  for (const ch of desc) {
    const pos = INPUT_CHARSET.indexOf(ch);
    if (pos < 0) return "";
    c = polymod(c, BigInt(pos & 31));
    cls = cls * 3n + BigInt(pos >> 5);
    if (++clscount === 3) {
      c = polymod(c, cls);
      cls = 0n;
      clscount = 0;
    }
  }
  if (clscount > 0) c = polymod(c, cls);
  for (let j = 0; j < 8; j++) c = polymod(c, 0n);
  c ^= 1n;
  let ret = "";
  for (let j = 0; j < 8; j++) ret += CHECKSUM_CHARSET[Number((c >> (5n * BigInt(7 - j))) & 31n)];
  return ret;
}

// Append "#checksum" to a descriptor body.
export function withChecksum(body) {
  return `${body}#${descriptorChecksum(body)}`;
}
