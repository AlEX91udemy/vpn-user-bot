import { InlineKeyboard } from 'grammy';

export function buildConnectionMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🤖 Android', 'connection:android')
    .text('🍎 iPhone', 'connection:iphone')
    .row()
    .text('🪟 Windows', 'connection:windows')
    .text('🍏 macOS', 'connection:macos')
    .row()
    .text('🏠 Домой', 'menu:home');
}
