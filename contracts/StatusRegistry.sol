// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * Status Registry: VC 폐기 상태 목록 (Bitstring 방식)
 * 각 발행자는 자신의 statusListId에 대한 bitstring을 관리한다.
 * 개인정보 없음 — 비트 인덱스가 폐기됐는지 여부만 저장.
 */
contract StatusRegistry {
    // listId => index => revoked
    mapping(uint256 => mapping(uint256 => bool)) private revokedBits;
    // listId => 발행자 주소 (권한 관리)
    mapping(uint256 => address) private listOwner;

    uint256 public nextListId = 1;

    event StatusListCreated(uint256 indexed listId, address indexed owner);
    event Revoked(uint256 indexed listId, uint256 index, string reason);

    // 발행자가 새 상태목록 생성
    function createStatusList() external returns (uint256 listId) {
        listId = nextListId++;
        listOwner[listId] = msg.sender;
        emit StatusListCreated(listId, msg.sender);
    }

    // VC 폐기 (사유 필수 — 감사 추적)
    function revoke(uint256 listId, uint256 index, string calldata reason) external {
        require(listOwner[listId] == msg.sender, "Not list owner");
        require(bytes(reason).length > 0, "Reason required");
        revokedBits[listId][index] = true;
        emit Revoked(listId, index, reason);
    }

    // 폐기 여부 조회 (검증자가 호출)
    function isRevoked(uint256 listId, uint256 index) external view returns (bool) {
        return revokedBits[listId][index];
    }

    function getListOwner(uint256 listId) external view returns (address) {
        return listOwner[listId];
    }
}
