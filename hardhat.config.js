require("@nomicfoundation/hardhat-toolbox");
/** Local-only config. No networks with keys are configured on purpose:
 *  deployment is a later, manual step (see deploy-package/DEPLOY.md). */
/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris",
      viaIR: true,
    },
  },
};
