require("dotenv").config();
const {
 ethers,
 HDNodeWallet
} = require("ethers");

const provider =
new ethers.JsonRpcProvider(
"https://bsc-dataseed.binance.org"
);

if (!process.env.MNEMONIC) { console.error("Set MNEMONIC in .env"); process.exit(1); }
const mnemonic = process.env.MNEMONIC;

// MASTER WALLET
const master =
HDNodeWallet
.fromPhrase(mnemonic)
.connect(provider);

// USER 5 PATH
const path =
"m/44'/60'/0'/0/5";

// CHILD WALLET
const child =
HDNodeWallet
.fromPhrase(
 mnemonic,
 undefined,
 path
)
.connect(provider);

// USDT CONTRACT
const usdtAddress =
"0x55d398326f99059fF775485246999027B3197955";

const abi = [
"function balanceOf(address owner) view returns (uint256)",
"function transfer(address to,uint amount) returns (bool)"
];

const usdt =
new ethers.Contract(
 usdtAddress,
 abi,
 child
);

async function sweep(){

console.log("CHECKING USDT BALANCE...");

const balance =
await usdt.balanceOf(
 child.address
);

console.log(
"USDT:",
ethers.formatUnits(balance,18)
);

// GAS ESTIMATION
const feeData =
await provider.getFeeData();

const gasPrice =
feeData.gasPrice;

const estimatedGas =
60000n;

const gasNeeded =
gasPrice * estimatedGas;

console.log(
"BNB NEEDED:",
ethers.formatEther(gasNeeded)
);

// SEND EXACT GAS
console.log("SENDING GAS...");

const gasTx =
await master.sendTransaction({
 to: child.address,
 value: gasNeeded
});

await gasTx.wait();

console.log("GAS SENT");

// SWEEP USDT
console.log("SWEEPING USDT...");

const tx =
await usdt.transfer(
 master.address,
 balance
);

const receipt =
await tx.wait();

console.log("USDT SWEPT");

console.log(tx.hash);

// CHECK LEFTOVER BNB
const remaining =
await provider.getBalance(
 child.address
);

console.log(
"LEFTOVER BNB:",
ethers.formatEther(remaining)
);

// LEAVE SMALL GAS BUFFER
const sendBack =
remaining -
ethers.parseEther("0.000005");

if(sendBack > 0){

console.log("SENDING BACK LEFTOVER BNB...");

const backTx =
await child.sendTransaction({
 to: master.address,
 value: sendBack
});

await backTx.wait();

console.log("LEFTOVER BNB RETURNED");

}

console.log("DONE");

}

sweep();