import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { parseEther } from "ethers/lib/utils";
import { ethers } from "hardhat";
import { promises as fs } from "fs";
import { IUniswapV2Router02 } from "../typechain";
const utils = ethers.utils;

const deadlineBuffer = 180;
const callingAddress = "0x0000000000000000000000000000000000000124";

describe("ToleranceCheck", async function () {
  let deployer: SignerWithAddress;
  let router: IUniswapV2Router02;
  const routerAddress = `${process.env.ROUTER_ADDRESS}`;

  let deadline: number;

  it("Can setup", async function () {
    [deployer] = await ethers.getSigners();
    router = await ethers.getContractAt("IUniswapV2Router02", routerAddress);

    deadline = (await ethers.provider.getBlock("latest")).timestamp + deadlineBuffer;
  });

  it("Should work with good erc20", async function () {
    // Deploy a normal ERC20 token
    const GoodERC20 = await ethers.getContractFactory("GoodERC20");
    const goodERC20 = await GoodERC20.deploy();
    await goodERC20.deployed();

    // List on Uniswap
    await goodERC20.approve(router.address, utils.parseEther("1000"));
    await router.addLiquidityETH(
      goodERC20.address,
      utils.parseEther("1000"),
      utils.parseEther("1000"),
      utils.parseEther("5"),
      deployer.address,
      deadline,
      { value: utils.parseEther("5") },
    );

    // Perform the tolerance check test
    const ToleranceCheck = await ethers.getContractFactory("ToleranceCheck");
    const deployData = ToleranceCheck.getDeployTransaction(
      router.address,
      goodERC20.address,
      utils.parseEther("0.01"),
    ).data;
    const returnedData = await ethers.provider.call({
      data: deployData,
      value: utils.parseEther("1"),
    });

    // 0x01 = true = successful
    expect(returnedData).to.be.eq("0x01");
  });

  it("Should successfully detect bad erc20", async function () {
    // Deploy a honeypot ERC20 token
    const BadERC20 = await ethers.getContractFactory("BadERC20");
    const badERC20 = await BadERC20.deploy(router.address);
    await badERC20.deployed();

    // List on Uniswap
    await badERC20.approve(router.address, utils.parseEther("1000"));
    await router.addLiquidityETH(
      badERC20.address,
      utils.parseEther("1000"),
      utils.parseEther("1000"),
      utils.parseEther("5"),
      deployer.address,
      deadline,
      { value: utils.parseEther("5") },
    );

    // Perform the tolerance check test
    const ToleranceCheck = await ethers.getContractFactory("ToleranceCheck");
    const deployData = ToleranceCheck.getDeployTransaction(
      router.address,
      badERC20.address,
      utils.parseEther("0.01"),
    ).data;

    // reverts = fail
    await expect(ethers.provider.call({ data: deployData, value: utils.parseEther("1") })).to.be.reverted;
  });

  it("EvilERC20 should be okay, when in fact when bought by a contract, it's evil", async function () {
    // Deploy an evil ERC20 token
    const EvilERC20 = await ethers.getContractFactory("EvilERC20");
    const evilERC20 = await EvilERC20.deploy(router.address);
    await evilERC20.deployed();

    // List on Uniswap
    await evilERC20.approve(router.address, utils.parseEther("1000"));
    await router.addLiquidityETH(
      evilERC20.address,
      utils.parseEther("1000"),
      utils.parseEther("1000"),
      utils.parseEther("5"),
      deployer.address,
      deadline,
      { value: utils.parseEther("5") },
    );

    // Perform the tolerance check test
    const ToleranceCheck = await ethers.getContractFactory("ToleranceCheck");
    const deployData = ToleranceCheck.getDeployTransaction(
      router.address,
      evilERC20.address,
      utils.parseEther("0.01"),
    ).data;
    const returnedData = await ethers.provider.call({
      data: deployData,
      value: utils.parseEther("1"),
    });

    // 0x01 = true = successful
    expect(returnedData).to.be.eq("0x01");

    // TokenBuyer is a simplified sandwich bot - it attempts to sandwich traders who buy with high slippage
    // In this scenario we've seen someone buying evilERC20 with a high amount of slippage, and our tolerance check contract says it's all good to sandwich!
    const TokenBuyer = await ethers.getContractFactory("TokenBuyer");
    const tokenBuyer = await TokenBuyer.deploy();
    await tokenBuyer.deployed();

    // we've bought tokens
    await tokenBuyer.buyTokens(router.address, evilERC20.address, utils.parseEther("2"), { value: parseEther("2") });

    // the sandwiched trade hopefully gets executed here

    // oh dear, we've been salmonella'd
    await expect(tokenBuyer.sellTokens(router.address, evilERC20.address)).to.be.revertedWith(
      "TransferHelper: TRANSFER_FROM_FAILED",
    );
  });

  it("Should successfully detect really evil erc20 tokens if we change the blockchain state", async function () {
    // Deploy an evil ERC20 token
    const EvilERC20 = await ethers.getContractFactory("EvilERC20");
    const evilERC20 = await EvilERC20.deploy(router.address);
    await evilERC20.deployed();

    // List on Uniswap
    await evilERC20.approve(router.address, utils.parseEther("1000"));
    await router.addLiquidityETH(
      evilERC20.address,
      utils.parseEther("1000"),
      utils.parseEther("1000"),
      utils.parseEther("5"),
      deployer.address,
      deadline,
      { value: utils.parseEther("5") },
    );

    // Perform the tolerance check test
    // This time, using hardhat_setCode so we can avoid really evil types of ERC20 tokens
    // As this ERC20 contract checks for a contract existing, we make it so there is one
    const ToleranceCheckOverrideDeployedBytecode = JSON.parse(
      await fs.readFile("./artifacts/contracts/ToleranceCheckOverride.sol/ToleranceCheckOverride.json", "utf-8"),
    ).deployedBytecode;
    await ethers.provider.send("hardhat_setCode", [callingAddress, ToleranceCheckOverrideDeployedBytecode]);
    await ethers.provider.send("hardhat_setBalance", [
      callingAddress,
      utils.hexStripZeros(utils.parseEther("1").toHexString()),
    ]);

    const ToleranceCheckOverride = await ethers.getContractFactory("ToleranceCheckOverride");
    const functionData = ToleranceCheckOverride.interface.encodeFunctionData("checkToken", [
      router.address,
      evilERC20.address,
      utils.parseEther("0.01"),
    ]);

    // reverts = fail
    await expect(
      ethers.provider.call({
        to: callingAddress,
        data: functionData,
        // value: utils.parseEther("1"),
      }),
    ).to.be.reverted;
  });
});
