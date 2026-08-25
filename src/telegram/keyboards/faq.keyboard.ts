import { InlineKeyboard } from 'grammy';

export function buildFaqKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📱 Сколько устройств можно подключить?', 'faq:devices')
    .row()
    .text('📲 Какое приложение использовать?', 'faq:apps')
    .row()
    .text('🔗 Где скачать приложение и получить настройки?', 'faq:download')
    .row()
    .text('💳 Как оформить ещё одну подписку?', 'faq:additional')
    .row()
    .text('💰 Как получить возврат средств?', 'faq:refund')
    .row()
    .text('⚡ VPN не подключается или работает медленно?', 'faq:connection')
    .row()
    .text('🤖 Что такое ИИ-помощник?', 'faq:ai')
    .row()
    .text('◀️ Назад', 'menu:support')
    .text('🏠 Домой', 'menu:home');
}

export function buildFaqBackKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('◀️ Назад', 'faq:back')
    .text('🏠 Домой', 'menu:home');
}
