(async function () {
  var subtitle = document.getElementById("subtitle");
  var list = document.getElementById("list");

  try {
    var ctx = await cyfers.getContext();
    subtitle.textContent =
      ctx.schoolName +
      (ctx.schoolYear ? " · " + ctx.schoolYear : "");

    var data = await cyfers.fetch("/rest/v1/leerlingen");
    var items = (data && data.items) || ctx.students || [];

    if (!items.length) {
      list.innerHTML = '<li class="empty">Geen leerlingen gevonden.</li>';
      return;
    }

    list.innerHTML = items
      .map(function (student) {
        var name =
          student.name ||
          [student.roepnaam, student.achternaam].filter(Boolean).join(" ") ||
          "Onbekend";
        var meta =
          student.studentNumber ||
          student.leerlingnummer ||
          student.email ||
          "";
        return (
          "<li><b>" +
          escapeHtml(name) +
          "</b><span>" +
          escapeHtml(String(meta)) +
          "</span></li>"
        );
      })
      .join("");
  } catch (err) {
    subtitle.className = "error";
    subtitle.textContent = err.message || "Kon leerlingen niet laden.";
  }

  function escapeHtml(value) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
