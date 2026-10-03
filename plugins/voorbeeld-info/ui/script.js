/** @param {CyfersContext} ctx */
function render(ctx) {
  document.getElementById("out").textContent =
    "Hallo " +
    (ctx.students[0] && ctx.students[0].name ? ctx.students[0].name : "leerling") +
    " van " +
    ctx.schoolName +
    ".";
}

cyfers.getContext().then(render).catch(function (err) {
  var out = document.getElementById("out");
  out.className = "error";
  out.textContent = err.message;
});
