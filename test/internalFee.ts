import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { IUniswapV2Router02 } from "../typechain";
const utils = ethers.utils;

const deadlineBuffer = 180;

describe("InternalFee", async function () {
  let deployer: SignerWithAddress;
  let router: IUniswapV2Router02;

  let deadline: number;

  it("Can setup", async function () {
    [deployer] = await ethers.getSigners();
    const routerAddress = `${process.env.ROUTER_ADDRESS}`;

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

    // Perform the internal fee test
    const InternalFee = await ethers.getContractFactory("InternalFee");
    const deployData = InternalFee.getDeployTransaction(router.address, goodERC20.address).data;
    const returnedData = await ethers.provider.call({
      data: deployData,
      value: utils.parseEther("1"),
    });

    // 0x01 = true = successful
    expect(returnedData).to.be.eq("0x01");
  });

  it("Should successfully detect fee erc20", async function () {
    // Deploy an ERC20 token with a high fee
    const FeeERC20 = await ethers.getContractFactory("FeeERC20");
    const feeERC20 = await FeeERC20.deploy(router.address);
    await feeERC20.deployed();

    // List on Uniswap
    await feeERC20.approve(router.address, utils.parseEther("1000"));
    await router.addLiquidityETH(
      feeERC20.address,
      utils.parseEther("1000"),
      utils.parseEther("1000"),
      utils.parseEther("5"),
      deployer.address,
      deadline,
      { value: utils.parseEther("5") },
    );

    // Perform the internal fee test
    const InternalFee = await ethers.getContractFactory("InternalFee");
    const deployData = InternalFee.getDeployTransaction(router.address, feeERC20.address).data;

    const returnedData = await ethers.provider.call({
      data: deployData,
      value: utils.parseEther("1"),
    });

    // 0x00 = false = fail
    expect(returnedData).to.be.eq("0x00");
  });
});
