// Independent structural validator for the CLI-produced .aseprite files.
// Deliberately written from the Aseprite format spec, NOT reusing the repo's
// encoder or the test's reader, so it is a third opinion on the bytes on disk.
import { inflateSync } from "node:zlib";
import { readFileSync } from "node:fs";

const files = process.argv.slice(2);
let bad = 0;

for (const file of files) {
  const b = readFileSync(file);
  const problems = [];
  const check = (cond, msg) => { if (!cond) problems.push(msg); };

  // ---- header ----
  check(b.length >= 128, "shorter than a header");
  const fileSize = b.readUInt32LE(0);
  check(fileSize === b.length, `header size ${fileSize} != file length ${b.length}`);
  check(b.readUInt16LE(4) === 0xa5e0, "bad file magic");
  const frames = b.readUInt16LE(6);
  const W = b.readUInt16LE(8), H = b.readUInt16LE(10);
  const depth = b.readUInt16LE(12);
  const flags = b.readUInt32LE(14);
  check(depth === 8, `depth ${depth} != 8`);
  check(W > 0 && H > 0, "zero canvas");
  const transparent = b[33];
  const ncolors = b.readUInt16LE(32);
  for (let i = 44; i < 128; i++) check(b[i] === 0, `header padding byte ${i} not zero`);
  check(transparent === 0, `transparent index ${transparent} != 0`);

  // ---- walk every frame and chunk, bounds-checked ----
  let p = 128;
  const layers = [];
  const palette = [];
  const tags = [];
  const durations = [];
  let cels = 0, compressed = 0, raw = 0;
  let firstFrameLayers = null;

  for (let f = 0; f < frames; f++) {
    const fstart = p;
    check(p + 16 <= b.length, `frame ${f} header past EOF`);
    const fsize = b.readUInt32LE(p);
    check(fsize >= 16, `frame ${f} size ${fsize} < 16`);
    check(fstart + fsize <= b.length, `frame ${f} overruns EOF`);
    check(b.readUInt16LE(p + 4) === 0xf1fa, `frame ${f} bad magic`);
    const u16chunks = b.readUInt16LE(p + 6);
    durations.push(b.readUInt16LE(p + 8));
    check(b.readUInt16LE(p + 10) === 0, `frame ${f} nonzero padding`);
    const nchunks = b.readUInt32LE(p + 12);
    check(u16chunks === Math.min(nchunks, 0xffff), `frame ${f} u16/u32 chunk count disagree`);

    let c = p + 16;
    const frameLayers = [];
    for (let k = 0; k < nchunks; k++) {
      check(c + 6 <= fstart + fsize, `frame ${f} chunk ${k} header past frame end`);
      const cstart = c;
      const csize = b.readUInt32LE(c);
      const type = b.readUInt16LE(c + 4);
      check(csize >= 6, `frame ${f} chunk ${k} size ${csize} < 6`);
      check(cstart + csize <= fstart + fsize, `frame ${f} chunk ${k} overruns frame`);
      if (type === 4) {
        check(f === 0, "palette chunk outside first frame");
        const packets = b.readUInt16LE(c + 6);
        let q = c + 8;
        for (let m = 0; m < packets; m++) {
          q += 1; // skip
          let n = b.readUInt8(q); q += 1;
          if (n === 0) n = 256;
          check(q + n * 3 <= cstart + csize, "palette packet overruns chunk");
          for (let i = 0; i < n; i++) { palette.push([b[q], b[q+1], b[q+2]]); q += 3; }
        }
        check(q === cstart + csize, `palette chunk has ${cstart + csize - q} trailing bytes`);
        check(palette.length === ncolors, `palette has ${palette.length} entries, header says ${ncolors}`);
      } else if (type === 0x2004) {
        check(f === 0, "layer chunk outside first frame");
        // After the 6-byte chunk header: u16 flags, u16 type, u16 child level,
        // u16 default w, u16 default h, u16 blend mode, u8 opacity, 3 pad,
        // then a u16-length-prefixed name.
        const lflags = b.readUInt16LE(c + 6);
        const ltype = b.readUInt16LE(c + 8);
        check(ltype === 0, `layer type ${ltype} (want 0 = image)`);
        check((lflags & 1) === 1, "layer is not flagged visible");
        check(b.readUInt16LE(c + 16) === 0, "layer blend mode not normal");
        check(b[c + 18] === 255, `layer opacity ${b[c + 18]} != 255`);
        check(b[c + 19] === 0 && b[c + 20] === 0 && b[c + 21] === 0, "layer padding not zero");
        const nl = b.readUInt16LE(c + 22);
        const name = b.toString("utf8", c + 24, c + 24 + nl);
        check(c + 24 + nl === cstart + csize, `layer "${name}" length mismatch`);
        check(nl > 0, "layer name is empty");
        frameLayers.push(name);
        layers.push(name);
      } else if (type === 0x2005) {
        cels++;
        // u16 layer, i16 x, i16 y, u8 opacity, u16 type, i16 z, 5 pad,
        // then for image cels u16 w, u16 h and the pixel data.
        const li = b.readUInt16LE(c + 6);
        check(li < layers.length, `cel references layer ${li} but only ${layers.length} declared`);
        check(b[c + 12] === 255, `cel opacity ${b[c + 12]} != 255`);
        const celType = b.readUInt16LE(c + 13);
        check(celType === 0 || celType === 2, `cel type ${celType}`);
        for (const z of [17, 18, 19, 20, 21]) check(b[c + z] === 0, `cel padding byte ${z} not zero`);
        const cw = b.readUInt16LE(c + 22), ch = b.readUInt16LE(c + 24);
        check(cw > 0 && ch > 0, `cel ${cw}x${ch} is empty`);
        const body = b.subarray(c + 26, cstart + csize);
        let px;
        if (celType === 2) { compressed++; px = new Uint8Array(inflateSync(body)); }
        else { raw++; px = new Uint8Array(body); }
        check(px.length === cw * ch, `cel pixel count ${px.length} != ${cw}x${ch}`);
        for (const v of px) check(v < palette.length, `cel index ${v} outside palette (${palette.length})`);
      } else if (type === 0x2018) {
        check(f === 0, "tags chunk outside first frame");
        // Body after the 6-byte chunk header: u16 ntags, u32 reserved, u32 reserved.
        const nt = b.readUInt16LE(c + 6);
        check(b.readUInt32LE(c + 8) === 0 && b.readUInt32LE(c + 12) === 0, "tags reserved bytes not zero");
        let q = c + 16;
        for (let m = 0; m < nt; m++) {
          const from = b.readUInt16LE(q), to = b.readUInt16LE(q + 2);
          q += 4;   // from, to
          q += 1;   // animation direction
          q += 2;   // repeat
          q += 6;   // 6 reserved bytes
          q += 4;   // tag colour r,g,b + one skipped byte
          const nl = b.readUInt16LE(q); q += 2;
          const name = b.toString("utf8", q, q + nl); q += nl;
          check(from <= to, `tag "${name}" from ${from} > to ${to}`);
          check(to < frames, `tag "${name}" to ${to} >= ${frames} frames`);
          tags.push({ from, to, name });
        }
        check(q === cstart + csize, "tags chunk length mismatch");
      } else {
        problems.push(`frame ${f} unknown chunk type 0x${type.toString(16)}`);
      }
      c = cstart + csize;
    }
    check(c === fstart + fsize, `frame ${f} walk ended at ${c}, expected ${fstart + fsize}`);
    if (f === 0) firstFrameLayers = frameLayers;
    p = fstart + fsize;
  }
  check(p === b.length, `walk ended at ${p}, file is ${b.length}`);

  // tags must partition the frames in row order
  let at = 0;
  for (const t of tags) { check(t.from === at, `tag "${t.name}" starts at ${t.from}, expected ${at}`); at = t.to + 1; }
  check(at === frames, `tags cover ${at} of ${frames} frames`);

  // Label from the file name (docs/samples/aseprite/<kit>.aseprite), so the
  // output identifies which sample failed.
  const name = file.split("/").pop();
  if (problems.length) {
    bad++;
    console.log(`FAIL ${name}: ${problems.length} problem(s)`);
    problems.slice(0, 8).forEach((x) => console.log(`   - ${x}`));
  } else {
    console.log(
      `OK   ${name}: ${b.length}B ${W}x${H} depth8 ${frames}f ${cels}cels (${compressed} zlib/${raw} raw) ` +
      `${palette.length}col ${tags.length}tags [${tags.map((t) => `${t.name}:${t.from}-${t.to}`).join(" ")}] ` +
      `layers=[${firstFrameLayers.join(",")}] dur=${[...new Set(durations)]}ms flags=${flags}`,
    );
  }
}
process.exit(bad ? 1 : 0);