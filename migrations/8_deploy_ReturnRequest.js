const ReturnRequestContract = artifacts.require("ReturnRequestContract");

module.exports = function (deployer) {
  deployer.deploy(ReturnRequestContract);
};