// Imports
let BCHJS  = require('@psf/bch-js')
let BCHLib = require('bitcoincashjs-lib')
let fs = require('fs')

// Settings
let MAINNET = 'https://bchn.fullstack.cash/v4/'
let TESTNET = 'https://testnet3.fullstack.cash/v4/'
// let NETWORK = 'testnet' OR 'mainnet'

module.exports = class BitcoinCashWallet {
  constructor(NETWORK) {
    this.bchjs = (NETWORK === 'mainnet') ? new BCHJS({restURL: MAINNET}) : new BCHJS({restURL: TESTNET})
    this.net = NETWORK
  }

  createWallet(name=null) {
    return new Promise(async (resolve,reject) => {
      try {
        let Mnemonic = this.bchjs.Mnemonic.generate(128,this.bchjs.Mnemonic.wordLists()['english'])
        let RootSeed = await this.bchjs.Mnemonic.toSeed(Mnemonic)
        let MasterNode = this.bchjs.HDNode.fromSeed(RootSeed)
        let ChildNode  = MasterNode.derivePath("m/44'/145'/0'/0/0")
        
        let Obj = {}
        Obj.mnemonic = Mnemonic
        Obj.cashAddress = this.bchjs.HDNode.toCashAddress(ChildNode)
        Obj.legacyAddress = this.bchjs.HDNode.toLegacyAddress(ChildNode)
        Obj.WIF = this.bchjs.HDNode.toWIF(ChildNode)
        
        if (name) fs.writeFileSync(`./wallets/test/${name}.json`,JSON.stringify(Obj,null,2))
        resolve(Obj)
      } catch (err) { reject(err) }
    })
  }

  checkBalance(address) {
    return new Promise(async (resolve,reject) => {
      try {
        this.bchjs.Electrumx.balance(address).then(({balance}) => resolve(balance.confirmed))
      } catch (err) { reject(err) }
    })
  }

  getUTXO(addr) {
    return new Promise(async (resolve,reject) => {
      try {
        let result = (await this.bchjs.Electrumx.utxo(addr)).utxos
        if (result.length === 0) { reject('ERROR: No UTXOs Found') } else { resolve(result) }
      } catch (err) { reject(err) }
    })
  }

  gatherUTXO(addr,amount) {
    return new Promise(async (resolve,reject) => {
      try {
        // Check if Balance is Enough
        let balance = await this.checkBalance(addr)
        if (balance < amount) { reject('ERROR: Insufficient Balance') }

        // Sort UTXO in Descending Order of Value
        let utxos = (await this.getUTXO(addr)).sort((x,y) => y.value - x.value)
        
        // Gather UTXOs to Specified Amount
        let gathered = 0, index = 0
        while (gathered < amount) {
          gathered += utxos[index].value
          index++
        }

        resolve({utxos: utxos.slice(0,index+1),amount: gathered})
      } catch (err) { reject(err) }
    })
  }

  // Generate a change address from a Mnemonic of a private key.
  changeAddrFromMnemonic(mnemonic) {
    return new Promise(async (resolve,reject) => {
      try {
        let rootSeed = await this.bchjs.Mnemonic.toSeed(mnemonic)                 // Root Seed Buffer
        let masterHDNode = this.bchjs.HDNode.fromSeed(rootSeed,this.net)          // Master HD Node
        let account = this.bchjs.HDNode.derivePath(masterHDNode,"m/44'/145'/0'")  // HDNode of BIP44 Account
        resolve(this.bchjs.HDNode.derivePath(account,'0/0'))
      } catch (err) { reject(err) }
    })
  }

  sendBCH(from,to,amount,mnemonic,fee) {
    return new Promise(async (resolve,reject) => {
      try {
        // Basic Error Checking
        if (!from || !to || !amount) { reject('ERROR: Specify Addresses & Amount') }
        
        // Convert to Legacy Address (needed to build transactions).
        const LEGACY_SEND = this.bchjs.Address.toLegacyAddress(from)
        const LEGACY_RECV = this.bchjs.Address.toLegacyAddress(to)
        console.log(`Sender   Legacy Address: ${LEGACY_SEND}`)
        console.log(`Receiver Legacy Address: ${LEGACY_RECV}`)
        
        // Gather Inputs
        let {utxos: inputs,amount: inp_amount} = await this.gatherUTXO(LEGACY_SEND,amount)
        let transactionBuilder = new this.bchjs.TransactionBuilder(this.net)
        inputs.forEach(inp => transactionBuilder.addInput(inp.tx_hash,inp.tx_pos))
        
        // Compute Transaction Fee & Change
        let byteCount = this.bchjs.BitcoinCash.getByteCount({P2PKH: inputs.length},{P2PKH: 2})
        let satoshisPerByte = 2   // Default: Pay 2 Sat/B
        let txFee    = (fee) ? fee : Math.floor(satoshisPerByte * byteCount)
        let txChange = inp_amount - amount - txFee
        if (txChange < 0) { reject('ERROR: Fee not Covered') }
        console.log(`Transaction Fee: ${txFee}`)
        console.log(`Transaction Change: ${txChange}`)
        
        // Gather Outputs
        transactionBuilder.addOutput(LEGACY_RECV, amount)
        transactionBuilder.addOutput(LEGACY_SEND, txChange)
        
        // Generate Change Address & Keypair from a PK-Mnemonic
        let changeAddr = await this.changeAddrFromMnemonic(mnemonic)
        let keyPair    = this.bchjs.HDNode.toKeyPair(changeAddr)
        
        // Sign Transaction
        let redeemScript
        inputs.forEach(inp => transactionBuilder.sign(inp.tx_pos,keyPair,redeemScript,transactionBuilder.hashTypes.SIGHASH_ALL,inp.value))
        
        // Broadcast Transation
        let tx_hex = transactionBuilder.build().toHex()
        let txid = await this.bchjs.RawTransactions.sendRawTransaction([tx_hex])
        console.log(`TX Hex: ${tx_hex}`);
        resolve(`TX ID: ${txid}`)
      } catch (err) { reject(err) }
    })
  }
}

// Helper Functions
function getSignedInputs(InpArray,userIndex) {
  return InpArray[userIndex].ins.filter(x => x.script.toString('hex') !== '')
}