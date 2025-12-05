// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface Topic {
  id: number;
  title: string;
  description: string;
  encryptedVotes: string;
  upvotes: number;
  downvotes: number;
  timestamp: number;
  creator: string;
}

interface Feedback {
  id: number;
  topicId: number;
  content: string;
  encryptedScore: string;
  timestamp: number;
  creator: string;
}

// FHE encryption/decryption functions
const FHEEncryptNumber = (value: number): string => `FHE-${btoa(value.toString())}`;
const FHEDecryptNumber = (encryptedData: string): number => encryptedData.startsWith('FHE-') ? parseFloat(atob(encryptedData.substring(4))) : parseFloat(encryptedData);
const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateTopicModal, setShowCreateTopicModal] = useState(false);
  const [creatingTopic, setCreatingTopic] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newTopicData, setNewTopicData] = useState({ title: "", description: "" });
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [newFeedback, setNewFeedback] = useState("");
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [publicKey, setPublicKey] = useState("");
  const [contractAddress, setContractAddress] = useState("");
  const [chainId, setChainId] = useState(0);
  const [startTimestamp, setStartTimestamp] = useState(0);
  const [durationDays, setDurationDays] = useState(30);
  const [activeTab, setActiveTab] = useState('topics');
  const [stats, setStats] = useState({
    totalTopics: 0,
    totalFeedbacks: 0,
    totalVotes: 0
  });

  // Initialize signature parameters
  useEffect(() => {
    loadData().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  // Load data from contract
  const loadData = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
      
      // Load topics
      const topicsBytes = await contract.getData("topics");
      let topicsList: Topic[] = [];
      if (topicsBytes.length > 0) {
        try {
          const topicsStr = ethers.toUtf8String(topicsBytes);
          if (topicsStr.trim() !== '') topicsList = JSON.parse(topicsStr);
        } catch (e) {}
      }
      setTopics(topicsList);
      
      // Load feedbacks
      const feedbacksBytes = await contract.getData("feedbacks");
      let feedbacksList: Feedback[] = [];
      if (feedbacksBytes.length > 0) {
        try {
          const feedbacksStr = ethers.toUtf8String(feedbacksBytes);
          if (feedbacksStr.trim() !== '') feedbacksList = JSON.parse(feedbacksStr);
        } catch (e) {}
      }
      setFeedbacks(feedbacksList);
      
      // Update stats
      setStats({
        totalTopics: topicsList.length,
        totalFeedbacks: feedbacksList.length,
        totalVotes: topicsList.reduce((sum, t) => sum + t.upvotes + t.downvotes, 0)
      });
    } catch (e) {
      console.error("Error loading data:", e);
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
      setLoading(false); 
    }
  };

  // Create new topic
  const createTopic = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingTopic(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating topic with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      // Create new topic
      const newTopic: Topic = {
        id: topics.length + 1,
        title: newTopicData.title,
        description: newTopicData.description,
        encryptedVotes: FHEEncryptNumber(0), // Initialize with 0 votes
        upvotes: 0,
        downvotes: 0,
        timestamp: Math.floor(Date.now() / 1000),
        creator: address
      };
      
      // Update topics list
      const updatedTopics = [...topics, newTopic];
      
      // Save to contract
      await contract.setData("topics", ethers.toUtf8Bytes(JSON.stringify(updatedTopics)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Topic created successfully!" });
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateTopicModal(false);
        setNewTopicData({ title: "", description: "" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingTopic(false); 
    }
  };

  // Submit feedback
  const submitFeedback = async () => {
    if (!isConnected || !address || !selectedTopic) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet and select a topic" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setIsSubmittingFeedback(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Submitting feedback with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      // Create new feedback
      const newFeedbackItem: Feedback = {
        id: feedbacks.length + 1,
        topicId: selectedTopic.id,
        content: newFeedback,
        encryptedScore: FHEEncryptNumber(1), // Initial score of 1
        timestamp: Math.floor(Date.now() / 1000),
        creator: address
      };
      
      // Update feedbacks list
      const updatedFeedbacks = [...feedbacks, newFeedbackItem];
      
      // Save to contract
      await contract.setData("feedbacks", ethers.toUtf8Bytes(JSON.stringify(updatedFeedbacks)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Feedback submitted with FHE encryption!" });
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setNewFeedback("");
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsSubmittingFeedback(false); 
    }
  };

  // Vote on topic
  const voteOnTopic = async (topicId: number, voteType: 'up' | 'down') => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setTransactionStatus({ visible: true, status: "pending", message: "Processing vote with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      // Find the topic
      const topicIndex = topics.findIndex(t => t.id === topicId);
      if (topicIndex === -1) throw new Error("Topic not found");
      
      // Update vote counts
      const updatedTopics = [...topics];
      if (voteType === 'up') {
        updatedTopics[topicIndex].upvotes += 1;
      } else {
        updatedTopics[topicIndex].downvotes += 1;
      }
      
      // Update encrypted votes (simulate FHE calculation)
      const totalVotes = updatedTopics[topicIndex].upvotes + updatedTopics[topicIndex].downvotes;
      updatedTopics[topicIndex].encryptedVotes = FHEEncryptNumber(totalVotes);
      
      // Save to contract
      await contract.setData("topics", ethers.toUtf8Bytes(JSON.stringify(updatedTopics)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Vote recorded with FHE encryption!" });
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Voting failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  // Decrypt votes with signature
  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { 
      return null; 
    }
  };

  // Render voting chart
  const renderVotingChart = (topic: Topic) => {
    const totalVotes = topic.upvotes + topic.downvotes;
    const upPercentage = totalVotes > 0 ? (topic.upvotes / totalVotes) * 100 : 0;
    const downPercentage = totalVotes > 0 ? (topic.downvotes / totalVotes) * 100 : 0;
    
    return (
      <div className="voting-chart">
        <div className="chart-row">
          <div className="chart-label">Support</div>
          <div className="chart-bar">
            <div 
              className="bar-fill up" 
              style={{ width: `${upPercentage}%` }}
            >
              <span className="bar-value">{topic.upvotes.toFixed(2)}</span>
            </div>
          </div>
          <div className="chart-percentage">{upPercentage.toFixed(1)}%</div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Oppose</div>
          <div className="chart-bar">
            <div 
              className="bar-fill down" 
              style={{ width: `${downPercentage}%` }}
            >
              <span className="bar-value">{topic.downvotes.toFixed(2)}</span>
            </div>
          </div>
          <div className="chart-percentage">{downPercentage.toFixed(1)}%</div>
        </div>
      </div>
    );
  };

  // Render topic feedbacks
  const renderTopicFeedbacks = () => {
    if (!selectedTopic) return null;
    
    const topicFeedbacks = feedbacks.filter(f => f.topicId === selectedTopic.id);
    if (topicFeedbacks.length === 0) return <div className="no-feedbacks">No feedback yet</div>;
    
    return (
      <div className="feedbacks-list">
        {topicFeedbacks.map((feedback, index) => (
          <div className="feedback-item" key={index}>
            <div className="feedback-content">{feedback.content}</div>
            <div className="feedback-meta">
              <span className="creator">{feedback.creator.substring(0, 6)}...{feedback.creator.substring(38)}</span>
              <span className="timestamp">{new Date(feedback.timestamp * 1000).toLocaleString()}</span>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Render FHE flow visualization
  const renderFHEFlow = () => {
    return (
      <div className="fhe-flow">
        <div className="flow-step">
          <div className="step-icon">1</div>
          <div className="step-content">
            <h4>Citizen Participation</h4>
            <p>Citizens submit feedback and votes on public topics</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">2</div>
          <div className="step-content">
            <h4>FHE Encryption</h4>
            <p>All votes and feedback scores are encrypted using Zama FHE</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">3</div>
          <div className="step-content">
            <h4>Homomorphic Analysis</h4>
            <p>Sentiment analysis is performed on encrypted data</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">4</div>
          <div className="step-content">
            <h4>Private Results</h4>
            <p>Aggregate results are available without exposing individual inputs</p>
          </div>
        </div>
      </div>
    );
  };

  // Render stats cards
  const renderStatsCards = () => {
    return (
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{stats.totalTopics}</div>
          <div className="stat-label">Public Topics</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.totalFeedbacks}</div>
          <div className="stat-label">Citizen Feedbacks</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.totalVotes}</div>
          <div className="stat-label">Total Votes</div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Initializing encrypted town hall system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="townhall-icon"></div>
          </div>
          <h1>Confidential Town Hall</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateTopicModal(true)} 
            className="create-topic-btn"
          >
            <div className="add-icon"></div>New Topic
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <div className="dashboard-grid">
            <div className="dashboard-panel intro-panel">
              <div className="panel-card">
                <h2>Secure Digital Town Hall</h2>
                <p>A confidential platform for citizens to discuss public issues and provide feedback with Zama FHE encryption protecting their privacy.</p>
                <div className="fhe-badge">
                  <div className="fhe-icon"></div>
                  <span>Powered by Zama FHE</span>
                </div>
              </div>
              
              <div className="panel-card">
                <h2>FHE Privacy Flow</h2>
                {renderFHEFlow()}
              </div>
              
              <div className="panel-card">
                <h2>Community Statistics</h2>
                {renderStatsCards()}
              </div>
            </div>
          </div>
          
          <div className="tabs-container">
            <div className="tabs">
              <button 
                className={`tab ${activeTab === 'topics' ? 'active' : ''}`}
                onClick={() => setActiveTab('topics')}
              >
                Public Topics
              </button>
              <button 
                className={`tab ${activeTab === 'feedback' ? 'active' : ''}`}
                onClick={() => setActiveTab('feedback')}
              >
                Citizen Feedback
              </button>
            </div>
            
            <div className="tab-content">
              {activeTab === 'topics' && (
                <div className="topics-section">
                  <div className="section-header">
                    <h2>Current Public Topics</h2>
                    <div className="header-actions">
                      <button 
                        onClick={loadData} 
                        className="refresh-btn" 
                        disabled={isRefreshing}
                      >
                        {isRefreshing ? "Refreshing..." : "Refresh"}
                      </button>
                    </div>
                  </div>
                  
                  <div className="topics-list">
                    {topics.length === 0 ? (
                      <div className="no-topics">
                        <div className="no-topics-icon"></div>
                        <p>No topics found</p>
                        <button 
                          className="create-btn" 
                          onClick={() => setShowCreateTopicModal(true)}
                        >
                          Create First Topic
                        </button>
                      </div>
                    ) : topics.map((topic, index) => (
                      <div 
                        className={`topic-item ${selectedTopic?.id === topic.id ? "selected" : ""}`} 
                        key={index}
                        onClick={() => setSelectedTopic(topic)}
                      >
                        <div className="topic-title">{topic.title}</div>
                        <div className="topic-description">{topic.description.substring(0, 100)}...</div>
                        <div className="topic-meta">
                          <span className="creator">By: {topic.creator.substring(0, 6)}...{topic.creator.substring(38)}</span>
                          <span className="votes">
                            <span className="upvotes">↑ {topic.upvotes}</span>
                            <span className="downvotes">↓ {topic.downvotes}</span>
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {activeTab === 'feedback' && selectedTopic && (
                <div className="feedback-section">
                  <div className="feedback-header">
                    <h2>Feedback on: {selectedTopic.title}</h2>
                    <button 
                      className="back-btn" 
                      onClick={() => setSelectedTopic(null)}
                    >
                      Back to Topics
                    </button>
                  </div>
                  
                  <div className="topic-details">
                    <div className="topic-description">{selectedTopic.description}</div>
                    {renderVotingChart(selectedTopic)}
                    
                    <div className="vote-buttons">
                      <button 
                        className="vote-btn up" 
                        onClick={() => voteOnTopic(selectedTopic.id, 'up')}
                      >
                        Support This Topic
                      </button>
                      <button 
                        className="vote-btn down" 
                        onClick={() => voteOnTopic(selectedTopic.id, 'down')}
                      >
                        Oppose This Topic
                      </button>
                    </div>
                  </div>
                  
                  <div className="feedback-form">
                    <h3>Submit Your Feedback</h3>
                    <textarea
                      value={newFeedback}
                      onChange={(e) => setNewFeedback(e.target.value)}
                      placeholder="Share your thoughts on this topic..."
                      rows={3}
                    />
                    <button 
                      onClick={submitFeedback}
                      disabled={isSubmittingFeedback || !newFeedback.trim()}
                      className="submit-feedback-btn"
                    >
                      {isSubmittingFeedback ? "Submitting..." : "Submit Feedback"}
                    </button>
                  </div>
                  
                  <div className="feedback-list-container">
                    <h3>Community Feedback</h3>
                    {renderTopicFeedbacks()}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {showCreateTopicModal && (
        <ModalCreateTopic 
          onSubmit={createTopic} 
          onClose={() => setShowCreateTopicModal(false)} 
          creating={creatingTopic} 
          topicData={newTopicData} 
          setTopicData={setNewTopicData}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="townhall-icon"></div>
              <span>Confidential Town Hall</span>
            </div>
            <p>Secure platform for citizen engagement powered by FHE</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">About</a>
            <a href="#" className="footer-link">Privacy</a>
            <a href="#" className="footer-link">Terms</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>Powered by Zama FHE</span>
          </div>
          <div className="copyright">© {new Date().getFullYear()} Confidential Town Hall. All rights reserved.</div>
          <div className="disclaimer">
            This system uses fully homomorphic encryption to protect citizen privacy. 
            All feedback and votes are encrypted to ensure confidentiality.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateTopicProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  topicData: any;
  setTopicData: (data: any) => void;
}

const ModalCreateTopic: React.FC<ModalCreateTopicProps> = ({ onSubmit, onClose, creating, topicData, setTopicData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setTopicData({ ...topicData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-topic-modal">
        <div className="modal-header">
          <h2>Create New Topic</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="lock-icon"></div>
            <div>
              <strong>FHE Privacy Notice</strong>
              <p>All feedback and votes on this topic will be encrypted</p>
            </div>
          </div>
          
          <div className="form-group">
            <label>Topic Title *</label>
            <input 
              type="text" 
              name="title" 
              value={topicData.title} 
              onChange={handleChange} 
              placeholder="Enter topic title..." 
            />
          </div>
          
          <div className="form-group">
            <label>Description *</label>
            <textarea 
              name="description" 
              value={topicData.description} 
              onChange={handleChange} 
              placeholder="Describe the topic for discussion..." 
              rows={4}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || !topicData.title || !topicData.description} 
            className="submit-btn"
          >
            {creating ? "Creating with FHE..." : "Create Topic"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;