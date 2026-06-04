require("dotenv").config();
const { HDNodeWallet } = require("ethers");

if (!process.env.MNEMONIC) { console.error("Set MNEMONIC in .env"); process.exit(1); }
const mnemonic = process.env.MNEMONIC;

console.log("MASTER WALLET");

const master =
HDNodeWallet.fromPhrase(mnemonic);

console.log(master.address);

console.log("================================");

for(let i = 1; i <= 5; i++) {

const path =
"m/44'/60'/0'/0/" + i;

const child =
HDNodeWallet.fromPhrase(
mnemonic,
undefined,
path
);

console.log("USER " + i);

console.log("ADDRESS:");
console.log(child.address);

console.log("PRIVATE KEY:");
console.log(child.privateKey);

console.log("================================");

}