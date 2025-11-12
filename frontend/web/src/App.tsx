import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface PaySlipData {
  id: string;
  employeeName: string;
  encryptedSalary: string;
  publicBonus: number;
  publicDeductions: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [paySlips, setPaySlips] = useState<PaySlipData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingPaySlip, setCreatingPaySlip] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newPaySlipData, setNewPaySlipData] = useState({ 
    employeeName: "", 
    salary: "", 
    bonus: "", 
    deductions: "",
    description: ""
  });
  const [selectedPaySlip, setSelectedPaySlip] = useState<PaySlipData | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [userHistory, setUserHistory] = useState<string[]>([]);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const paySlipsList: PaySlipData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          paySlipsList.push({
            id: businessId,
            employeeName: businessData.name,
            encryptedSalary: businessId,
            publicBonus: Number(businessData.publicValue1) || 0,
            publicDeductions: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setPaySlips(paySlipsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createPaySlip = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingPaySlip(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating encrypted pay slip..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const salaryValue = parseInt(newPaySlipData.salary) || 0;
      const businessId = `payslip-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, salaryValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newPaySlipData.employeeName,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newPaySlipData.bonus) || 0,
        parseInt(newPaySlipData.deductions) || 0,
        newPaySlipData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setUserHistory(prev => [...prev, `Created pay slip for ${newPaySlipData.employeeName}`]);
      setTransactionStatus({ visible: true, status: "success", message: "Pay slip created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewPaySlipData({ employeeName: "", salary: "", bonus: "", deductions: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingPaySlip(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      setUserHistory(prev => [...prev, `Decrypted salary data for ${businessId}`]);
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Salary decrypted successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const result = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available and ready!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Contract call failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredPaySlips = paySlips.filter(paySlip => 
    paySlip.employeeName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    paySlip.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const stats = {
    totalPaySlips: paySlips.length,
    verifiedPaySlips: paySlips.filter(p => p.isVerified).length,
    totalBonus: paySlips.reduce((sum, p) => sum + p.publicBonus, 0),
    totalDeductions: paySlips.reduce((sum, p) => sum + p.publicDeductions, 0),
    avgBonus: paySlips.length > 0 ? paySlips.reduce((sum, p) => sum + p.publicBonus, 0) / paySlips.length : 0
  };

  const renderStats = () => (
    <div className="stats-panels">
      <div className="stat-panel metal-gold">
        <h3>Total Pay Slips</h3>
        <div className="stat-value">{stats.totalPaySlips}</div>
        <div className="stat-trend">FHE Encrypted</div>
      </div>
      
      <div className="stat-panel metal-silver">
        <h3>Verified Data</h3>
        <div className="stat-value">{stats.verifiedPaySlips}/{stats.totalPaySlips}</div>
        <div className="stat-trend">On-chain Verified</div>
      </div>
      
      <div className="stat-panel metal-bronze">
        <h3>Avg Bonus</h3>
        <div className="stat-value">${stats.avgBonus.toFixed(0)}</div>
        <div className="stat-trend">Public Data</div>
      </div>
    </div>
  );

  const renderSalaryChart = () => {
    const salaryRanges = [
      { range: "0-1000", count: paySlips.filter(p => p.decryptedValue && p.decryptedValue <= 1000).length },
      { range: "1001-3000", count: paySlips.filter(p => p.decryptedValue && p.decryptedValue > 1000 && p.decryptedValue <= 3000).length },
      { range: "3001-5000", count: paySlips.filter(p => p.decryptedValue && p.decryptedValue > 3000 && p.decryptedValue <= 5000).length },
      { range: "5000+", count: paySlips.filter(p => p.decryptedValue && p.decryptedValue > 5000).length }
    ];

    const maxCount = Math.max(...salaryRanges.map(r => r.count));

    return (
      <div className="salary-chart">
        <h3>Salary Distribution (FHE 🔐)</h3>
        <div className="chart-bars">
          {salaryRanges.map((range, index) => (
            <div key={index} className="chart-bar">
              <div className="bar-label">{range.range}</div>
              <div className="bar-container">
                <div 
                  className="bar-fill metal-gradient"
                  style={{ height: maxCount > 0 ? `${(range.count / maxCount) * 100}%` : '0%' }}
                >
                  <span className="bar-count">{range.count}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header metal-header">
          <div className="logo">
            <h1>🔐 FHE Salary System</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt metal-bg">
          <div className="connection-content">
            <div className="metal-envelope">💼</div>
            <h2>Connect Wallet to Access Encrypted Salary System</h2>
            <p>Secure, confidential pay slip management powered by Zama FHE technology</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen metal-bg">
        <div className="metal-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  return (
    <div className="app-container metal-theme">
      <header className="app-header metal-header">
        <div className="logo">
          <h1>💼 FHE Salary System</h1>
        </div>
        
        <div className="header-actions">
          <button onClick={callIsAvailable} className="metal-btn test-btn">
            Test Contract
          </button>
          <button onClick={() => setShowCreateModal(true)} className="metal-btn primary-btn">
            + New Pay Slip
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-section metal-panel">
          <h2>Salary Management Dashboard</h2>
          {renderStats()}
          {renderSalaryChart()}
        </div>

        <div className="search-section metal-panel">
          <div className="search-header">
            <h2>Encrypted Pay Slips</h2>
            <div className="search-controls">
              <input
                type="text"
                placeholder="Search employees..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="metal-input"
              />
              <button onClick={loadData} disabled={isRefreshing} className="metal-btn">
                {isRefreshing ? "🔄" : "Refresh"}
              </button>
            </div>
          </div>
        </div>

        <div className="content-panels">
          <div className="pay-slips-panel metal-panel">
            <div className="pay-slips-list">
              {filteredPaySlips.length === 0 ? (
                <div className="no-data metal-bg">
                  <p>No pay slips found</p>
                  <button onClick={() => setShowCreateModal(true)} className="metal-btn">
                    Create First Pay Slip
                  </button>
                </div>
              ) : filteredPaySlips.map((paySlip, index) => (
                <div 
                  key={index}
                  className={`pay-slip-item ${selectedPaySlip?.id === paySlip.id ? "selected" : ""} ${paySlip.isVerified ? "verified" : ""}`}
                  onClick={() => setSelectedPaySlip(paySlip)}
                >
                  <div className="pay-slip-header">
                    <h3>{paySlip.employeeName}</h3>
                    <span className={`status-badge ${paySlip.isVerified ? "verified" : "encrypted"}`}>
                      {paySlip.isVerified ? "✅ Verified" : "🔒 Encrypted"}
                    </span>
                  </div>
                  <div className="pay-slip-details">
                    <span>Bonus: ${paySlip.publicBonus}</span>
                    <span>Deductions: ${paySlip.publicDeductions}</span>
                    {paySlip.isVerified && paySlip.decryptedValue && (
                      <span className="salary-verified">Salary: ${paySlip.decryptedValue}</span>
                    )}
                  </div>
                  <div className="pay-slip-meta">
                    <span>{new Date(paySlip.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="details-panel metal-panel">
            {selectedPaySlip ? (
              <PaySlipDetail 
                paySlip={selectedPaySlip}
                onClose={() => setSelectedPaySlip(null)}
                isDecrypting={isDecrypting || fheIsDecrypting}
                decryptData={() => decryptData(selectedPaySlip.id)}
              />
            ) : (
              <div className="selection-prompt">
                <div className="metal-icon">💼</div>
                <h3>Select a Pay Slip</h3>
                <p>Choose a pay slip from the list to view details and decrypt salary information</p>
              </div>
            )}
          </div>
        </div>

        <div className="history-panel metal-panel">
          <h3>User Activity History</h3>
          <div className="history-list">
            {userHistory.length === 0 ? (
              <p>No activity recorded</p>
            ) : (
              userHistory.slice(-5).map((item, index) => (
                <div key={index} className="history-item">
                  <span className="history-time">{new Date().toLocaleTimeString()}</span>
                  <span>{item}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <footer className="app-footer metal-footer">
          <p>FHE Salary System v1.0 - Powered by Zama FHE Technology</p>
        </footer>
      </div>
      
      {showCreateModal && (
        <CreatePaySlipModal 
          onSubmit={createPaySlip}
          onClose={() => setShowCreateModal(false)}
          creating={creatingPaySlip || isEncrypting}
          paySlipData={newPaySlipData}
          setPaySlipData={setNewPaySlipData}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            <div className="toast-icon">
              {transactionStatus.status === "pending" && <div className="metal-spinner small"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <span>{transactionStatus.message}</span>
          </div>
        </div>
      )}
    </div>
  );
};

const CreatePaySlipModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  paySlipData: any;
  setPaySlipData: (data: any) => void;
}> = ({ onSubmit, onClose, creating, paySlipData, setPaySlipData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'salary' || name === 'bonus' || name === 'deductions') {
      const intValue = value.replace(/[^\d]/g, '');
      setPaySlipData({ ...paySlipData, [name]: intValue });
    } else {
      setPaySlipData({ ...paySlipData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay metal-overlay">
      <div className="create-modal metal-modal">
        <div className="modal-header">
          <h2>Create Encrypted Pay Slip</h2>
          <button onClick={onClose} className="close-btn">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice metal-notice">
            <strong>FHE 🔐 Encryption Notice</strong>
            <p>Salary amount will be encrypted using Zama FHE technology</p>
          </div>
          
          <div className="form-group">
            <label>Employee Name *</label>
            <input 
              type="text"
              name="employeeName"
              value={paySlipData.employeeName}
              onChange={handleChange}
              className="metal-input"
              placeholder="Enter employee name"
            />
          </div>
          
          <div className="form-group">
            <label>Salary Amount (FHE Encrypted) *</label>
            <input 
              type="number"
              name="salary"
              value={paySlipData.salary}
              onChange={handleChange}
              className="metal-input"
              placeholder="Enter salary amount"
            />
            <span className="data-type">🔐 FHE Encrypted Integer</span>
          </div>
          
          <div className="form-group">
            <label>Bonus Amount *</label>
            <input 
              type="number"
              name="bonus"
              value={paySlipData.bonus}
              onChange={handleChange}
              className="metal-input"
              placeholder="Enter bonus amount"
            />
            <span className="data-type">📊 Public Data</span>
          </div>
          
          <div className="form-group">
            <label>Deductions *</label>
            <input 
              type="number"
              name="deductions"
              value={paySlipData.deductions}
              onChange={handleChange}
              className="metal-input"
              placeholder="Enter deductions"
            />
            <span className="data-type">📊 Public Data</span>
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea
              name="description"
              value={paySlipData.description}
              onChange={handleChange}
              className="metal-input"
              placeholder="Additional notes"
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="metal-btn secondary-btn">Cancel</button>
          <button 
            onClick={onSubmit}
            disabled={creating || !paySlipData.employeeName || !paySlipData.salary}
            className="metal-btn primary-btn"
          >
            {creating ? "Encrypting..." : "Create Pay Slip"}
          </button>
        </div>
      </div>
    </div>
  );
};

const PaySlipDetail: React.FC<{
  paySlip: PaySlipData;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ paySlip, onClose, isDecrypting, decryptData }) => {
  const [localDecrypted, setLocalDecrypted] = useState<number | null>(null);

  const handleDecrypt = async () => {
    const result = await decryptData();
    setLocalDecrypted(result);
  };

  const netSalary = (paySlip.isVerified ? paySlip.decryptedValue : localDecrypted) || 0 + paySlip.publicBonus - paySlip.publicDeductions;

  return (
    <div className="pay-slip-detail">
      <div className="detail-header">
        <h3>{paySlip.employeeName}</h3>
        <button onClick={onClose} className="close-btn">&times;</button>
      </div>
      
      <div className="detail-content">
        <div className="info-grid">
          <div className="info-item">
            <label>Employee</label>
            <span>{paySlip.employeeName}</span>
          </div>
          <div className="info-item">
            <label>Created</label>
            <span>{new Date(paySlip.timestamp * 1000).toLocaleDateString()}</span>
          </div>
          <div className="info-item">
            <label>Bonus</label>
            <span>${paySlip.publicBonus}</span>
          </div>
          <div className="info-item">
            <label>Deductions</label>
            <span>${paySlip.publicDeductions}</span>
          </div>
        </div>
        
        <div className="salary-section">
          <div className="salary-header">
            <h4>Salary Information</h4>
            <button 
              onClick={handleDecrypt}
              disabled={isDecrypting || paySlip.isVerified}
              className={`metal-btn decrypt-btn ${paySlip.isVerified ? 'verified' : ''}`}
            >
              {isDecrypting ? "Decrypting..." : paySlip.isVerified ? "✅ Verified" : "🔓 Decrypt Salary"}
            </button>
          </div>
          
          <div className="salary-display">
            {paySlip.isVerified ? (
              <div className="salary-amount verified">
                <span>Base Salary: ${paySlip.decryptedValue}</span>
                <small>On-chain Verified</small>
              </div>
            ) : localDecrypted ? (
              <div className="salary-amount decrypted">
                <span>Base Salary: ${localDecrypted}</span>
                <small>Locally Decrypted</small>
              </div>
            ) : (
              <div className="salary-amount encrypted">
                <span>Base Salary: 🔐 Encrypted</span>
                <small>FHE Protected</small>
              </div>
            )}
            
            <div className="net-salary">
              <strong>Net Salary: ${netSalary}</strong>
            </div>
          </div>
        </div>
        
        <div className="description">
          <label>Description</label>
          <p>{paySlip.description}</p>
        </div>
      </div>
    </div>
  );
};

export default App;


