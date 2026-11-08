import {
  QUESTS,
  NPCS,
  resolveQuestId,
  resolveZoneId,
  resolveMonsterId,
  getItemById,
} from '../config.js';
import {
  createAppError,
  assertCharacterAlive,
  applyXpGain,
} from './leveling.js';
import {
  addItemToCharacterInventory,
  consumeItemFromCharacterInventory,
} from './combat.js';
import { runInTransaction } from '../db/database.js';
import {
  getCharacterById,
  saveCharacter,
  getCharacterQuests,
  removeItemFromInventory,
} from '../db/repositories.js';

export function getNpcBadgeForQuestStatus(status) {
  switch (status) {
    case 'READY_TO_TURN_IN':
      return '?';
    case 'AVAILABLE':
      return '!';
    case 'ACTIVE':
      return '⏳';
    case 'COMPLETED':
      return '✓';
    default:
      return '🔒';
  }
}

export function enrichQuestsWithBadges(questsList = []) {
  return questsList.map((q) => {
    const npcDef = NPCS[q.npcId] || null;
    const badge = getNpcBadgeForQuestStatus(q.status);
    const currentCount = Number(q.currentCount ?? q.progress ?? 0);
    const requiredCount = Number(q.requiredCount ?? 1);
    const readyToTurnIn =
      q.status === 'READY_TO_TURN_IN' ||
      (q.status === 'ACTIVE' && currentCount >= requiredCount);
    const lethalityRating = q.lethalityRating || q.lethality || 'LOW';
    return {
      ...q,
      name: q.title || q.name,
      title: q.title || q.name,
      currentCount,
      progress: currentCount,
      requiredCount,
      readyToTurnIn,
      npcName: npcDef?.name || q.npcId,
      npcBadge: badge,
      badge,
      lethalityRating,
      lethality: lethalityRating,
      isHighLethality: ['HIGH', 'EXTREME', 'LETHAL'].includes(lethalityRating),
    };
  });
}

export function acceptQuest(db, characterId, questIdInput) {
  return runInTransaction(db, () => {
    const character = getCharacterById(db, characterId);
    assertCharacterAlive(character);

    const resolvedId = resolveQuestId(questIdInput);
    if (!resolvedId || !Object.hasOwn(QUESTS, resolvedId)) {
      throw createAppError(
        404,
        'QUEST_NOT_FOUND',
        'ERR_QUEST_NOT_FOUND',
        `Quest "${questIdInput}" not found.`
      );
    }

    const questDef = QUESTS[resolvedId];
    const questRow = db
      .prepare('SELECT * FROM quests WHERE character_id = ? AND quest_id = ?')
      .get(character.id, questDef.id);

    const currentStatus = questRow ? questRow.status : 'LOCKED';

    if (currentStatus === 'COMPLETED') {
      throw createAppError(
        400,
        'QUEST_ALREADY_COMPLETED',
        'ERR_QUEST_ALREADY_COMPLETED',
        `Quest "${questDef.title}" has already been completed.`
      );
    }

    if (currentStatus === 'ACTIVE' || currentStatus === 'READY_TO_TURN_IN') {
      throw createAppError(
        400,
        'QUEST_ALREADY_ACTIVE',
        'ERR_QUEST_ALREADY_ACTIVE',
        `Quest "${questDef.title}" is already active.`
      );
    }

    // Verify prerequisite and minLevel
    if (questDef.prerequisiteQuestId) {
      const prereqRow = db
        .prepare('SELECT status FROM quests WHERE character_id = ? AND quest_id = ?')
        .get(character.id, questDef.prerequisiteQuestId);
      if (!prereqRow || prereqRow.status !== 'COMPLETED') {
        throw createAppError(
          403,
          'QUEST_LOCKED',
          'ERR_QUEST_LOCKED',
          `Quest "${questDef.title}" requires completing "${questDef.prerequisiteQuestId}" first.`
        );
      }
    }

    if ((character.level || 1) < (questDef.minLevel || 1)) {
      throw createAppError(
        403,
        'QUEST_LOCKED',
        'ERR_QUEST_LOCKED',
        `Quest "${questDef.title}" requires Hero Level ${questDef.minLevel}.`
      );
    }

    const nowIso = new Date().toISOString();
    let initialCount = 0;
    let initialStatus = 'ACTIVE';

    // If EXPLORE quest is accepted while character is already in targetZoneId, auto-complete objective
    const currentZone = resolveZoneId(character.currentZoneId || character.zoneId);
    if (questDef.type === 'EXPLORE' && currentZone === questDef.targetZoneId) {
      initialCount = questDef.requiredCount;
      initialStatus = 'READY_TO_TURN_IN';
    }

    db.prepare(`
      INSERT INTO quests (
        character_id, quest_id, status, current_count, required_count, accepted_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(character_id, quest_id) DO UPDATE SET
        status = excluded.status,
        current_count = excluded.current_count,
        accepted_at = excluded.accepted_at,
        completed_at = NULL
    `).run(
      character.id,
      questDef.id,
      initialStatus,
      initialCount,
      questDef.requiredCount,
      nowIso
    );

    const updatedQuests = enrichQuestsWithBadges(
      getCharacterQuests(db, character.id, character.level)
    );
    const questState = updatedQuests.find((q) => q.questId === questDef.id);
    const updatedCharacter = getCharacterById(db, character.id);
    updatedCharacter.quests = updatedQuests;

    return {
      questState,
      quests: updatedQuests,
      character: updatedCharacter,
    };
  });
}

export function abandonQuest(db, characterId, questIdInput) {
  return runInTransaction(db, () => {
    const character = getCharacterById(db, characterId);
    assertCharacterAlive(character);

    const resolvedId = resolveQuestId(questIdInput);
    if (!resolvedId || !Object.hasOwn(QUESTS, resolvedId)) {
      throw createAppError(
        404,
        'QUEST_NOT_FOUND',
        'ERR_QUEST_NOT_FOUND',
        `Quest "${questIdInput}" not found.`
      );
    }

    const questDef = QUESTS[resolvedId];
    const questRow = db
      .prepare('SELECT * FROM quests WHERE character_id = ? AND quest_id = ?')
      .get(character.id, questDef.id);

    const currentStatus = questRow ? questRow.status : 'LOCKED';
    if (currentStatus !== 'ACTIVE' && currentStatus !== 'READY_TO_TURN_IN') {
      throw createAppError(
        400,
        'QUEST_NOT_ACTIVE',
        'ERR_QUEST_NOT_ACTIVE',
        `Quest "${questDef.title}" is not currently active.`
      );
    }

    // If abandoning a COLLECT quest, remove partial quest items from inventory
    if (questDef.type === 'COLLECT' && questDef.targetId) {
      const existingItem = (character.inventory || []).find(
        (i) => (i.itemId || i.id) === questDef.targetId
      );
      if (existingItem && existingItem.quantity > 0) {
        removeItemFromInventory(db, character.id, questDef.targetId, existingItem.quantity);
      }
    }

    const prereqMet =
      !questDef.prerequisiteQuestId ||
      db
        .prepare('SELECT status FROM quests WHERE character_id = ? AND quest_id = ?')
        .get(character.id, questDef.prerequisiteQuestId)?.status === 'COMPLETED';
    const nextStatus =
      prereqMet && (character.level || 1) >= (questDef.minLevel || 1)
        ? 'AVAILABLE'
        : 'LOCKED';

    db.prepare(`
      UPDATE quests
      SET status = ?, current_count = 0, accepted_at = NULL, completed_at = NULL
      WHERE character_id = ? AND quest_id = ?
    `).run(nextStatus, character.id, questDef.id);

    const updatedQuests = enrichQuestsWithBadges(
      getCharacterQuests(db, character.id, character.level)
    );
    const questState = updatedQuests.find((q) => q.questId === questDef.id);
    const updatedCharacter = getCharacterById(db, character.id);
    updatedCharacter.quests = updatedQuests;

    return {
      questState,
      quests: updatedQuests,
      character: updatedCharacter,
    };
  });
}

export function completeQuest(db, characterId, questIdInput, options = {}) {
  return runInTransaction(db, () => {
    const character = getCharacterById(db, characterId, options);
    assertCharacterAlive(character);

    const resolvedId = resolveQuestId(questIdInput);
    if (!resolvedId || !Object.hasOwn(QUESTS, resolvedId)) {
      throw createAppError(
        404,
        'QUEST_NOT_FOUND',
        'ERR_QUEST_NOT_FOUND',
        `Quest "${questIdInput}" not found.`
      );
    }

    const questDef = QUESTS[resolvedId];
    const questRow = db
      .prepare('SELECT * FROM quests WHERE character_id = ? AND quest_id = ?')
      .get(character.id, questDef.id);

    const currentStatus = questRow ? questRow.status : 'LOCKED';
    if (currentStatus === 'COMPLETED') {
      throw createAppError(
        400,
        'QUEST_ALREADY_COMPLETED',
        'ERR_QUEST_ALREADY_COMPLETED',
        `Quest "${questDef.title}" has already been completed.`
      );
    }

    if (currentStatus !== 'ACTIVE' && currentStatus !== 'READY_TO_TURN_IN') {
      throw createAppError(
        400,
        'QUEST_NOT_ACTIVE',
        'ERR_QUEST_NOT_ACTIVE',
        `Quest "${questDef.title}" is not active.`
      );
    }

    const currentCount = Number(questRow?.current_count || 0);
    if (currentCount < questDef.requiredCount) {
      throw createAppError(
        400,
        'QUEST_OBJECTIVES_INCOMPLETE',
        'ERR_QUEST_OBJECTIVES_INCOMPLETE',
        `Quest "${questDef.title}" objectives are incomplete (${currentCount}/${questDef.requiredCount}).`
      );
    }

    // Consume collected quest items on turn-in
    if (questDef.type === 'COLLECT' && questDef.targetId) {
      consumeItemFromCharacterInventory(character, questDef.targetId, questDef.requiredCount);
    }

    const nowIso = new Date().toISOString();
    db.prepare(`
      UPDATE quests
      SET status = 'COMPLETED', current_count = ?, completed_at = ?
      WHERE character_id = ? AND quest_id = ?
    `).run(questDef.requiredCount, nowIso, character.id, questDef.id);

    const xpReward = Number(questDef.rewards?.xp || 0);
    const goldReward = Number(questDef.rewards?.gold || 0);
    const itemRewards = Array.isArray(questDef.rewards?.items) ? questDef.rewards.items : [];

    character.gold = Math.max(0, Number(character.gold || 0)) + goldReward;
    if (!character.statsRecord || typeof character.statsRecord !== 'object') {
      character.statsRecord = { monstersSlain: 0, bossesSlain: 0, questsCompleted: 0, goldEarned: 0 };
    }
    character.statsRecord.questsCompleted = (character.statsRecord.questsCompleted || 0) + 1;
    character.statsRecord.goldEarned = (character.statsRecord.goldEarned || 0) + goldReward;

    for (const rewardItem of itemRewards) {
      const rItemDef = getItemById(rewardItem.itemId);
      if (rItemDef) {
        addItemToCharacterInventory(character, rItemDef.id, rewardItem.quantity || 1);
      }
    }

    const levelUpResult = applyXpGain(character, xpReward, options);
    saveCharacter(db, character);

    const updatedQuests = enrichQuestsWithBadges(
      getCharacterQuests(db, character.id, character.level)
    );
    const questState = updatedQuests.find((q) => q.questId === questDef.id);
    const updatedCharacter = getCharacterById(db, character.id, options);
    updatedCharacter.quests = updatedQuests;

    return {
      questState,
      quests: updatedQuests,
      rewardsGranted: {
        xp: xpReward,
        gold: goldReward,
        items: itemRewards,
      },
      leveledUp: levelUpResult.leveledUp,
      levelUpResult,
      character: updatedCharacter,
    };
  });
}

export function progressExploreQuestsForZone(db, characterId, zoneIdInput, characterLevel = 1) {
  const zoneId = resolveZoneId(zoneIdInput);
  if (!zoneId) return [];

  const activeRows = db
    .prepare("SELECT * FROM quests WHERE character_id = ? AND status = 'ACTIVE'")
    .all(characterId);

  for (const row of activeRows) {
    if (!Object.hasOwn(QUESTS, row.quest_id)) continue;
    const qDef = QUESTS[row.quest_id];
    if (qDef.type === 'EXPLORE' && qDef.targetZoneId === zoneId) {
      db.prepare(`
        UPDATE quests
        SET current_count = ?, status = 'READY_TO_TURN_IN'
        WHERE character_id = ? AND quest_id = ?
      `).run(qDef.requiredCount, characterId, qDef.id);
    }
  }

  return enrichQuestsWithBadges(getCharacterQuests(db, characterId, characterLevel));
}

export function progressCombatQuestsOnVictory(
  db,
  characterId,
  monsterIdInput,
  zoneIdInput,
  lootDropped = [],
  characterLevel = 1
) {
  const monsterId = resolveMonsterId(monsterIdInput);
  const zoneId = resolveZoneId(zoneIdInput);

  const activeRows = db
    .prepare("SELECT * FROM quests WHERE character_id = ? AND status = 'ACTIVE'")
    .all(characterId);

  for (const row of activeRows) {
    if (!Object.hasOwn(QUESTS, row.quest_id)) continue;
    const qDef = QUESTS[row.quest_id];
    let nextCount = Number(row.current_count || 0);

    if (
      (qDef.type === 'KILL' || qDef.type === 'BOSS') &&
      qDef.targetId === monsterId &&
      (!qDef.targetZoneId || qDef.targetZoneId === zoneId)
    ) {
      nextCount = Math.min(qDef.requiredCount, nextCount + 1);
    } else if (qDef.type === 'COLLECT' && qDef.targetZoneId === zoneId) {
      const droppedCount = lootDropped
        .filter((item) => (item.itemId || item.id) === qDef.targetId)
        .reduce((acc, item) => acc + (Number(item.quantity) || 1), 0);
      if (droppedCount > 0) {
        nextCount = Math.min(qDef.requiredCount, nextCount + droppedCount);
      }
    }

    if (nextCount !== Number(row.current_count || 0)) {
      const nextStatus = nextCount >= qDef.requiredCount ? 'READY_TO_TURN_IN' : 'ACTIVE';
      db.prepare(`
        UPDATE quests
        SET current_count = ?, status = ?
        WHERE character_id = ? AND quest_id = ?
      `).run(nextCount, nextStatus, characterId, qDef.id);
    }
  }

  return enrichQuestsWithBadges(getCharacterQuests(db, characterId, characterLevel));
}
