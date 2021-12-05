// Imports
let bch = require('./src/main')

// Settings
let BCH = new bch('mainnet')
let Address1 = 'bitcoincash:qz0q4wdmeajzch48ht9f92r7kzscrsre7vm44j5aaq'
let Address2 = 'bitcoincash:qzpfzvt3cfrahqmsdmnua859459zf3ttdysdtjmprc'
let PrivKey1 = ''
let PrivKey2 = ''
let mnemonic1 = "pole quarter slush rebel inspire broom crouch clip purchase eagle kingdom blame"

// Maincode
// BCH.createWallet().then(console.log)
// BCH.getUTXO(Address1).then(console.log)
// BCH.maxUTXO(Address1).then(console.log)
// BCH.changeAddrFromMnemonic(mnemonic1).then(console.log)
// BCH.sendBCH(Address1,Address2,50000,mnemonic1,1000).then(console.log)

// Check Balances
Promise.all([Address1,Address2].map(addr => BCH.checkBalance(addr))).then(console.log)


let payment = 4000, cja = 600
// Gather UTXOs from your account starting from highest bills
Promise.all([Address1,Address2].map(addr => BCH.gatherUTXO(addr,payment))).then(info1 => {
  let Inputs = info1.map(x => x.utxos)
  let Amount = info1.map(x => x.amount)
  
  // Payment Amount | Coinjoin Amount | Fee
  Promise.all(Amount.map(amount => BCH.splitInput(payment,amount,cja,500))).then(info2 => {
    // At this point, private keys(WIF) are taken by the caller and kept securely.
    // Then, the information is filtered for the joined transaction.
    let Keyring = [],Outputs = [],ChangeKeys = []
    for (let i=0; i<info2.length; i++) {
      Keyring[i] = [],Outputs[i] = []
      info2[i].forEach(({account,value}) => {
        Keyring[i].push(account.WIF)
        Outputs[i].push({address: account.cashAddress,value})
        if (value !== cja) {ChangeKeys[i] = account.WIF}
      })
    }
    
    // Simulate Sending Inputs/Outputs to Coordinator
    BCH.combineIO(Inputs,Outputs).then(info3 => {
      // Simulate User Signing Process
      Promise.all([PrivKey1,PrivKey2].map((key,idx) => BCH.signPSBT(info3,key,Inputs[idx]))).then(info4 => {
        // Simulate Merging the Signatures
        BCH.mergeSigns(info4).then(info5 => {
          console.log(info5)
          // Broadcast Coinjoin Transaction
          BCH.broadcastPSBT(info5).then(info6 => console.log(info6))
        })
      })
    })
  })
})
