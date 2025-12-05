pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";


contract TownHallFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;
    uint256 public cooldownSeconds;
    bool public paused;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    struct Batch {
        uint256 id;
        bool isOpen;
        uint256 totalEncryptedVotesFor; // euint32 ciphertext
        uint256 totalEncryptedVotesAgainst; // euint32 ciphertext
        uint256 totalEncryptedVotesAbstain; // euint32 ciphertext
    }
    mapping(uint256 => Batch) public batches;
    uint256 public currentBatchId = 1;
    uint256 public nextBatchId = 1;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event CooldownSecondsSet(uint256 oldCooldownSeconds, uint256 newCooldownSeconds);
    event ContractPaused();
    event ContractUnpaused();
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event FeedbackSubmitted(address indexed provider, uint256 indexed batchId, uint256 encryptedVoteFor, uint256 encryptedVoteAgainst, uint256 encryptedVoteAbstain);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint32 totalVotesFor, uint32 totalVotesAgainst, uint32 totalVotesAbstain);

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchNotOpen();
    error BatchAlreadyOpen();
    error InvalidBatchId();
    error ReplayDetected();
    error StateMismatch();
    error DecryptionFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[owner] = true;
        cooldownSeconds = 60; // Default cooldown
        _initIfNeeded();
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        if (!isProvider[provider]) {
            isProvider[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) external onlyOwner {
        if (isProvider[provider]) {
            isProvider[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) external onlyOwner {
        uint256 oldCooldownSeconds = cooldownSeconds;
        cooldownSeconds = newCooldownSeconds;
        emit CooldownSecondsSet(oldCooldownSeconds, newCooldownSeconds);
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit ContractPaused();
    }

    function unpause() external onlyOwner {
        paused = false;
        emit ContractUnpaused();
    }

    function openBatch() external onlyOwner whenNotPaused {
        if (batches[nextBatchId].isOpen) revert BatchAlreadyOpen();
        currentBatchId = nextBatchId;
        batches[currentBatchId].id = currentBatchId;
        batches[currentBatchId].isOpen = true;
        batches[currentBatchId].totalEncryptedVotesFor = FHE.asEuint32(0).toBytes32();
        batches[currentBatchId].totalEncryptedVotesAgainst = FHE.asEuint32(0).toBytes32();
        batches[currentBatchId].totalEncryptedVotesAbstain = FHE.asEuint32(0).toBytes32();
        nextBatchId++;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch(uint256 batchId) external onlyOwner whenNotPaused {
        if (batchId != currentBatchId) revert InvalidBatchId();
        if (!batches[batchId].isOpen) revert BatchNotOpen();
        batches[batchId].isOpen = false;
        emit BatchClosed(batchId);
    }

    function submitFeedback(
        uint256 batchId,
        uint256 encryptedVoteFor,
        uint256 encryptedVoteAgainst,
        uint256 encryptedVoteAbstain
    ) external onlyProvider whenNotPaused {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) revert CooldownActive();
        if (batchId != currentBatchId) revert InvalidBatchId();
        if (!batches[batchId].isOpen) revert BatchNotOpen();

        _initIfNeeded();

        euint32 voteFor = euint32.wrap(encryptedVoteFor);
        euint32 voteAgainst = euint32.wrap(encryptedVoteAgainst);
        euint32 voteAbstain = euint32.wrap(encryptedVoteAbstain);

        euint32 currentTotalFor = euint32.wrap(batches[batchId].totalEncryptedVotesFor);
        euint32 currentTotalAgainst = euint32.wrap(batches[batchId].totalEncryptedVotesAgainst);
        euint32 currentTotalAbstain = euint32.wrap(batches[batchId].totalEncryptedVotesAbstain);

        batches[batchId].totalEncryptedVotesFor = FHE.add(currentTotalFor, voteFor).toBytes32();
        batches[batchId].totalEncryptedVotesAgainst = FHE.add(currentTotalAgainst, voteAgainst).toBytes32();
        batches[batchId].totalEncryptedVotesAbstain = FHE.add(currentTotalAbstain, voteAbstain).toBytes32();

        lastSubmissionTime[msg.sender] = block.timestamp;
        emit FeedbackSubmitted(msg.sender, batchId, encryptedVoteFor, encryptedVoteAgainst, encryptedVoteAbstain);
    }

    function requestBatchDecryption(uint256 batchId) external onlyOwner whenNotPaused {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) revert CooldownActive();
        if (batches[batchId].isOpen) revert BatchNotOpen(); // Batch must be closed

        euint32 totalFor = euint32.wrap(batches[batchId].totalEncryptedVotesFor);
        euint32 totalAgainst = euint32.wrap(batches[batchId].totalEncryptedVotesAgainst);
        euint32 totalAbstain = euint32.wrap(batches[batchId].totalEncryptedVotesAbstain);

        bytes32[] memory cts = new bytes32[](3);
        cts[0] = totalFor.toBytes32();
        cts[1] = totalAgainst.toBytes32();
        cts[2] = totalAbstain.toBytes32();

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({ batchId: batchId, stateHash: stateHash, processed: false });
        lastDecryptionRequestTime[msg.sender] = block.timestamp;
        emit DecryptionRequested(requestId, batchId);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayDetected();
        if (cleartexts.length != 12) revert DecryptionFailed(); // 3 * 4 bytes for uint32

        // Rebuild ciphertexts array from current storage
        Batch storage batch = batches[decryptionContexts[requestId].batchId];
        bytes32[] memory currentCts = new bytes32[](3);
        currentCts[0] = bytes32(batch.totalEncryptedVotesFor);
        currentCts[1] = bytes32(batch.totalEncryptedVotesAgainst);
        currentCts[2] = bytes32(batch.totalEncryptedVotesAbstain);

        bytes32 currentStateHash = _hashCiphertexts(currentCts);
        if (currentStateHash != decryptionContexts[requestId].stateHash) revert StateMismatch();

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32 totalVotesFor = abi.decode(cleartexts[0:4], (uint32));
        uint32 totalVotesAgainst = abi.decode(cleartexts[4:8], (uint32));
        uint32 totalVotesAbstain = abi.decode(cleartexts[8:12], (uint32));

        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, decryptionContexts[requestId].batchId, totalVotesFor, totalVotesAgainst, totalVotesAbstain);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded() internal {
        if (!FHE.isInitialized()) {
            FHE.initialize();
        }
    }
}