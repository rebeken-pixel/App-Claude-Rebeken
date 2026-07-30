// Token opaco (base64) usado para que el servidor no tenga que recordar nada
// entre pedidos: cada recordatorio/lista de una fuente externa viaja con los
// datos mínimos (IDs, URLs) que hacen falta para volver a operar sobre él.
function encodeToken(payload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeToken(token) {
  try {
    return JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch (err) {
    throw new Error("Token inválido o vencido; actualizá la página e intentá de nuevo.");
  }
}

module.exports = { encodeToken, decodeToken };
