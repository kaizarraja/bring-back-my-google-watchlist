// A stand-in for Google's sign-in during local tests: publishes a key set at
// http://127.0.0.1:8790/jwks and signs ID tokens with it at POST /token.
//   node test/fake-google.mjs
import http from "node:http";
import crypto from "node:crypto";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const kid = "test-key";
const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" };
const b64url = (buf) => Buffer.from(buf).toString("base64url");

function sign(claims) {
	const header = b64url(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
	const payload = b64url(JSON.stringify(claims));
	const signature = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey);
	return `${header}.${payload}.${b64url(signature)}`;
}

http
	.createServer((req, res) => {
		if (req.url === "/jwks") {
			res.setHeader("Content-Type", "application/json");
			return res.end(JSON.stringify({ keys: [jwk] }));
		}
		if (req.url === "/token" && req.method === "POST") {
			let body = "";
			req.on("data", (c) => (body += c));
			req.on("end", () => res.end(sign(JSON.parse(body))));
			return;
		}
		res.statusCode = 404;
		res.end();
	})
	.listen(8790, "127.0.0.1", () => console.log("fake Google keys on http://127.0.0.1:8790"));
