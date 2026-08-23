#!/usr/bin/env node

import {
  constants,
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  timingSafeEqual,
  verify,
} from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const CRX_MAGIC = Buffer.from('Cr24');
const CRX_VERSION = 3;
const CRX_ID_BYTES = 16;
const SIGNATURE_CONTEXT = Buffer.from('CRX3 SignedData\0');

function encodeVarint(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid protobuf varint');
  const bytes = [];
  let remaining = value;
  while (remaining >= 0x80) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining = Math.floor(remaining / 0x80);
  }
  bytes.push(remaining);
  return Buffer.from(bytes);
}

function encodeBytesField(fieldNumber, value) {
  const bytes = Buffer.from(value);
  return Buffer.concat([
    encodeVarint(fieldNumber * 8 + 2),
    encodeVarint(bytes.length),
    bytes,
  ]);
}

function decodeVarint(buffer, start) {
  let value = 0;
  let multiplier = 1;
  let offset = start;
  for (let index = 0; index < 10 && offset < buffer.length; index += 1) {
    const byte = buffer[offset];
    offset += 1;
    value += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) return { value, offset };
    multiplier *= 0x80;
  }
  throw new Error('Invalid protobuf varint');
}

function decodeBytesFields(buffer) {
  const fields = new Map();
  let offset = 0;
  while (offset < buffer.length) {
    const tag = decodeVarint(buffer, offset);
    offset = tag.offset;
    const wireType = tag.value & 7;
    if (wireType !== 2) throw new Error(`Unsupported protobuf wire type: ${wireType}`);
    const length = decodeVarint(buffer, offset);
    offset = length.offset;
    const end = offset + length.value;
    if (end > buffer.length) throw new Error('Truncated protobuf field');
    const fieldNumber = Math.floor(tag.value / 8);
    const entries = fields.get(fieldNumber) ?? [];
    entries.push(buffer.subarray(offset, end));
    fields.set(fieldNumber, entries);
    offset = end;
  }
  return fields;
}

function getSingleField(fields, fieldNumber, label) {
  const values = fields.get(fieldNumber) ?? [];
  if (values.length !== 1) throw new Error(`Expected one ${label} field`);
  return values[0];
}

function createCrxId(publicKeyDer) {
  return createHash('sha256').update(publicKeyDer).digest().subarray(0, CRX_ID_BYTES);
}

function encodeExtensionId(crxId) {
  return [...crxId.toString('hex')]
    .map((character) => String.fromCharCode(97 + Number.parseInt(character, 16)))
    .join('');
}

function createSignedPayload(signedHeaderData, zip) {
  const signedHeaderSize = Buffer.alloc(4);
  signedHeaderSize.writeUInt32LE(signedHeaderData.length);
  return Buffer.concat([SIGNATURE_CONTEXT, signedHeaderSize, signedHeaderData, zip]);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function assertZip(zip) {
  const signature = zip.subarray(0, 4).toString('binary');
  if (signature !== 'PK\x03\x04' && signature !== 'PK\x05\x06') {
    throw new Error('CRX payload is not a ZIP archive');
  }
}

function pack({ zipPath, keyPath, outputPath }) {
  const zip = readFileSync(zipPath);
  assertZip(zip);
  const privateKey = createPrivateKey(readFileSync(keyPath));
  const publicKey = createPublicKey(privateKey);
  const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' });
  const crxId = createCrxId(publicKeyDer);
  const signedHeaderData = encodeBytesField(1, crxId);
  const signature = sign('sha256', createSignedPayload(signedHeaderData, zip), {
    key: privateKey,
    padding: constants.RSA_PKCS1_PADDING,
  });
  const proof = Buffer.concat([
    encodeBytesField(1, publicKeyDer),
    encodeBytesField(2, signature),
  ]);
  const header = Buffer.concat([
    encodeBytesField(2, proof),
    encodeBytesField(10000, signedHeaderData),
  ]);
  const prefix = Buffer.alloc(12);
  CRX_MAGIC.copy(prefix);
  prefix.writeUInt32LE(CRX_VERSION, 4);
  prefix.writeUInt32LE(header.length, 8);
  const crx = Buffer.concat([prefix, header, zip]);
  writeFileSync(outputPath, crx, { mode: 0o644 });
  return {
    extensionId: encodeExtensionId(crxId),
    publicKey: publicKeyDer.toString('base64'),
    sha256: sha256(crx),
    size: crx.length,
  };
}

function inspect(crxPath, manifestPath) {
  const crx = readFileSync(crxPath);
  if (crx.length < 12 || !timingSafeEqual(crx.subarray(0, 4), CRX_MAGIC)) {
    throw new Error('Invalid CRX magic');
  }
  const version = crx.readUInt32LE(4);
  if (version !== CRX_VERSION) throw new Error(`Unsupported CRX version: ${version}`);
  const headerSize = crx.readUInt32LE(8);
  const zipOffset = 12 + headerSize;
  if (headerSize === 0 || zipOffset >= crx.length) throw new Error('Invalid CRX header size');

  const headerFields = decodeBytesFields(crx.subarray(12, zipOffset));
  const proof = getSingleField(headerFields, 2, 'RSA proof');
  const signedHeaderData = getSingleField(headerFields, 10000, 'signed header data');
  const proofFields = decodeBytesFields(proof);
  const publicKeyDer = getSingleField(proofFields, 1, 'public key');
  const signature = getSingleField(proofFields, 2, 'signature');
  const signedFields = decodeBytesFields(signedHeaderData);
  const storedCrxId = getSingleField(signedFields, 1, 'CRX ID');
  const calculatedCrxId = createCrxId(publicKeyDer);
  if (
    storedCrxId.length !== calculatedCrxId.length
    || !timingSafeEqual(storedCrxId, calculatedCrxId)
  ) {
    throw new Error('CRX ID does not match the signing public key');
  }

  const zip = crx.subarray(zipOffset);
  assertZip(zip);
  const publicKey = createPublicKey({ key: publicKeyDer, type: 'spki', format: 'der' });
  const validSignature = verify(
    'sha256',
    createSignedPayload(signedHeaderData, zip),
    { key: publicKey, padding: constants.RSA_PKCS1_PADDING },
    signature,
  );
  if (!validSignature) throw new Error('Invalid CRX signature');

  const manifest = manifestPath ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
  const publicKeyBase64 = publicKeyDer.toString('base64');
  if (manifest?.key && manifest.key !== publicKeyBase64) {
    throw new Error('Manifest key does not match the CRX signing key');
  }

  return {
    extensionId: encodeExtensionId(calculatedCrxId),
    manifestVersion: manifest?.version ?? null,
    publicKey: publicKeyBase64,
    sha256: sha256(crx),
    signatureValid: true,
    size: crx.length,
    version,
    zipSha256: sha256(zip),
  };
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith('--') || value === undefined) throw new Error('Invalid arguments');
    options[name.slice(2)] = value;
  }
  return options;
}

const [command, ...args] = process.argv.slice(2);
const options = parseOptions(args);
let result;
if (command === 'pack') {
  if (!options.zip || !options.key || !options.out) {
    throw new Error('Usage: crx3.mjs pack --zip extension.zip --key extension.pem --out extension.crx');
  }
  result = pack({ zipPath: options.zip, keyPath: options.key, outputPath: options.out });
} else if (command === 'verify') {
  if (!options.crx) {
    throw new Error('Usage: crx3.mjs verify --crx extension.crx [--manifest manifest.json]');
  }
  result = inspect(options.crx, options.manifest);
} else {
  throw new Error('Expected command: pack or verify');
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
