/**
 * commands/rpg/skill.js
 * View available skills.
 * Usage: !skills | !skill <id>
 */

import { getPlayer }          from '../../lib/game/player.js';
import { getClassSkills, getSkill } from '../../lib/game/skill.js';

let handler = async (m, { args }) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Register first: *!register <n> <class>*`);

  const skillId = args[0];

  if (skillId) {
    const skill = getSkill(skillId);
    if (!skill) return m.reply(`❌ Unknown skill: *${skillId}*`);
    const known = player.skills.includes(skillId);
    return m.reply(
      `🧿 *${skill.name}*\n` +
      `Class:    ${skill.class.join(', ')}\n` +
      `Mana:     ${skill.manaCost}\n` +
      `Cooldown: ${skill.cooldown} turn(s)\n` +
      `Type:     ${skill.type}\n` +
      `Element:  ${skill.element}\n\n` +
      `📖 ${skill.description}\n\n` +
      `Status: ${known ? '✅ Known' : '❌ Not learned'}`
    );
  }

  const allClassSkills = getClassSkills(player.class);
  const known   = allClassSkills.filter(s => player.skills.includes(s.id));
  const unknown = allClassSkills.filter(s => !player.skills.includes(s.id));

  const fmt = (s) =>
    `  🧿 *${s.name}* (${s.id})\n` +
    `     💙 ${s.manaCost} mana | ⏱ ${s.cooldown}t | ${s.description}`;

  return m.reply(
    `🧿 *${player.class} Skills*\n\n` +
    `✅ *Known (${known.length}):*\n` +
    (known.length ? known.map(fmt).join('\n') : '  None') +
    `\n\n❌ *Locked (${unknown.length}):*\n` +
    (unknown.length ? unknown.map(fmt).join('\n') : '  None') +
    `\n\n💡 Use in battle: *!battle <skill_id>*`
  );
};

handler.help    = ['skills', 'skill <id>'];
handler.tags    = ['rpg'];
handler.command = /^skills?$/i;
handler.cooldown = 10;

export default handler;
