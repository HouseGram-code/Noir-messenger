import { useAppStore } from '../lib/store';

const translations = {
  en: {
    profile: 'Profile',
    security: 'Security',
    about: 'About App',
    logout: 'Logout',
    edit: 'Edit',
    save: 'Save',
    cancel: 'Cancel',
    name: 'Name',
    username: 'Username',
    bio: 'Bio',
    theme: 'Theme Color',
    twoFactor: 'Two-Factor Auth',
    lastSeen: 'Show Last Seen',
    language: 'Language',
    changePassword: 'Change Password',
    close: 'Close',
    help: 'Help',
    createGroup: 'Create Group',
    groupName: 'Group Name',
    description: 'Description (optional)',
    create: 'Create',
    messages: 'Messages',
  },
  ru: {
    profile: 'Профиль',
    security: 'Безопасность',
    about: 'О приложении',
    logout: 'Выйти',
    edit: 'Редактировать',
    save: 'Сохранить',
    cancel: 'Отмена',
    name: 'Имя',
    username: 'Имя пользователя',
    bio: 'О себе',
    theme: 'Цвет темы',
    twoFactor: 'Двухфакторная аутентификация',
    lastSeen: 'Показывать статус "Был в сети"',
    language: 'Язык',
    changePassword: 'Сменить пароль',
    close: 'Закрыть',
    help: 'Помощь',
    createGroup: 'Создать группу',
    groupName: 'Название группы',
    description: 'Описание (необязательно)',
    create: 'Создать',
    messages: 'Сообщения',
  }
};

export const useTranslation = () => {
  const language = useAppStore((state) => state.language);
  const t = (key: keyof typeof translations.en) => translations[language][key] || key;
  return { t };
};
