pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract PaySlipZ is ZamaEthereumConfig {
    
    struct PaySlip {
        string employeeId;              
        euint32 encryptedSalary;        
        uint256 paymentDate;            
        uint256 taxRate;                
        string currency;                
        address issuer;                 
        uint256 issueTimestamp;         
        uint32 decryptedSalary;         
        bool isDecrypted;               
    }
    
    mapping(string => PaySlip) public paySlips;
    string[] public employeeIds;
    
    event PaySlipIssued(string indexed employeeId, address indexed issuer);
    event SalaryDecrypted(string indexed employeeId, uint32 decryptedSalary);
    
    constructor() ZamaEthereumConfig() {
    }
    
    function issuePaySlip(
        string calldata employeeId,
        externalEuint32 encryptedSalary,
        bytes calldata inputProof,
        uint256 paymentDate,
        uint256 taxRate,
        string calldata currency
    ) external {
        require(bytes(paySlips[employeeId].employeeId).length == 0, "Pay slip already exists");
        
        require(FHE.isInitialized(FHE.fromExternal(encryptedSalary, inputProof)), "Invalid encrypted salary");
        
        paySlips[employeeId] = PaySlip({
            employeeId: employeeId,
            encryptedSalary: FHE.fromExternal(encryptedSalary, inputProof),
            paymentDate: paymentDate,
            taxRate: taxRate,
            currency: currency,
            issuer: msg.sender,
            issueTimestamp: block.timestamp,
            decryptedSalary: 0,
            isDecrypted: false
        });
        
        FHE.allowThis(paySlips[employeeId].encryptedSalary);
        FHE.makePubliclyDecryptable(paySlips[employeeId].encryptedSalary);
        
        employeeIds.push(employeeId);
        
        emit PaySlipIssued(employeeId, msg.sender);
    }
    
    function decryptSalary(
        string calldata employeeId, 
        bytes memory abiEncodedClearSalary,
        bytes memory decryptionProof
    ) external {
        require(bytes(paySlips[employeeId].employeeId).length > 0, "Pay slip does not exist");
        require(!paySlips[employeeId].isDecrypted, "Salary already decrypted");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(paySlips[employeeId].encryptedSalary);
        
        FHE.checkSignatures(cts, abiEncodedClearSalary, decryptionProof);
        
        uint32 decodedSalary = abi.decode(abiEncodedClearSalary, (uint32));
        
        paySlips[employeeId].decryptedSalary = decodedSalary;
        paySlips[employeeId].isDecrypted = true;
        
        emit SalaryDecrypted(employeeId, decodedSalary);
    }
    
    function getEncryptedSalary(string calldata employeeId) external view returns (euint32) {
        require(bytes(paySlips[employeeId].employeeId).length > 0, "Pay slip does not exist");
        return paySlips[employeeId].encryptedSalary;
    }
    
    function getPaySlip(string calldata employeeId) external view returns (
        string memory employeeId_,
        uint256 paymentDate,
        uint256 taxRate,
        string memory currency,
        address issuer,
        uint256 issueTimestamp,
        bool isDecrypted,
        uint32 decryptedSalary
    ) {
        require(bytes(paySlips[employeeId].employeeId).length > 0, "Pay slip does not exist");
        PaySlip storage slip = paySlips[employeeId];
        
        return (
            slip.employeeId,
            slip.paymentDate,
            slip.taxRate,
            slip.currency,
            slip.issuer,
            slip.issueTimestamp,
            slip.isDecrypted,
            slip.decryptedSalary
        );
    }
    
    function getAllEmployeeIds() external view returns (string[] memory) {
        return employeeIds;
    }
    
    function isAvailable() public pure returns (bool) {
        return true;
    }
}


