(function (GP) {
  const Profiles = GP.Profiles = GP.Profiles || {};
  Profiles.current = null;
  Profiles.avatarUrl = profile => `${GP.API_BASE}/api/profile/avatar?username=${encodeURIComponent(profile.username)}&fx=1&v=${encodeURIComponent(profile.updated)}`;
  Profiles.node = function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  Profiles.button = function button(text, action) {
    const element = Profiles.node('button', text);
    element.type = 'button';
    element.addEventListener('click', action);
    return element;
  };
  Profiles.panel = function panel(title) {
    if (Profiles.current) Profiles.current.remove();
    Profiles.current = Profiles.node('section', '', 'profile-panel');
    const header = Profiles.node('div', '', 'profile-header');
    const target = Profiles.current;
    header.append(Profiles.node('strong', title), Profiles.button('close', () => target.remove()));
    Profiles.current.append(header);
    GP.dom.screen.append(Profiles.current);
    GP.autoScroll();
    return Profiles.current;
  };
})(window.GhostProtocol);
