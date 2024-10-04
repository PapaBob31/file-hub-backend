const express = require("express")
const app = express()


app.post('/', (req, res) => {
	console.log(req.body.name);
	res.status(200).send("Form received")
})

app.listen(7200);