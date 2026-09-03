window.GameRegistry = (function () {
  const games = [];
  function register(game) {
    const required = ["id", "name", "icon", "description", "howTo", "create"];
    if (!game || required.some((key) => !game[key]) || games.some((item) => item.id === game.id)) throw new Error("游戏注册信息无效或重复");
    games.push(Object.freeze({ ...game, howTo: [...game.howTo] }));
  }
  function get(id) { return games.find((game) => game.id === id) || null; }
  function all() { return games.slice(); }
  return { register, get, all };
})();
