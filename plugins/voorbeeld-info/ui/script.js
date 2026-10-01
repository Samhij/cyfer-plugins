cyfers.getContext().then(function (ctx) {
  document.getElementById("out").textContent =
    "Hallo " +
    (ctx.students[0] && ctx.students[0].name ? ctx.students[0].name : "leerling") +
    " van " +
    ctx.schoolName +
    ".";
}).catch(function (err) {
  var out = document.getElementById("out");
  out.className = "error";
  out.textContent = err.message;
});
