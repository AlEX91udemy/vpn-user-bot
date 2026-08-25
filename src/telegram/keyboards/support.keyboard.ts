import { InlineKeyboard } from 'grammy';

export function buildSupportMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text('❓ FAQ', 'support:faq')
    .row()
    .text('🔌 Не подключается', 'support:connection')
    .row()
    .text('💳 Проблема с оплатой', 'support:payment')
    .row()
    .text('✉️ Написать оператору', 'support:operator')
    .row()
    .text('🏠 Домой', 'menu:home');
}
