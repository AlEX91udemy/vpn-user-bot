import { InlineKeyboard } from 'grammy';

export function buildMainMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🛒 Купить VPN', 'menu:buy')
    .row()
    .text('📱 Моя подписка', 'menu:subscription')
    .text('📡 Мой MTProto', 'menu:mtproto')
    .row()
    .text('🎁 Пробный доступ', 'menu:trial')
    .text('🆘 Поддержка', 'menu:support')
    .row()
    .text('🤖 ИИ-помощник', 'menu:ai');
}

export const homeKeyboard = (): InlineKeyboard =>
  new InlineKeyboard().text('🏠 Домой', 'menu:home');
