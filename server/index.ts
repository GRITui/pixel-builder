// STUB — owned by Lane C.
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 8787);
createServer((_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ enabled: false, model: null, reason: "server stub" }));
}).listen(port, () => console.log(`api on :${port}`));
