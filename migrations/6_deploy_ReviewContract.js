const ReviewContract = artifacts.require("ReviewContract");

module.exports = function(deployer) {
  deployer.deploy(ReviewContract);
};
