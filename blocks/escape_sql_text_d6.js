module.exports = {
    name: "Escape SQL Text",

    description: "Adds a backslash before SQL special characters in up to five text values.",

    category: ".d6",

    inputs: [
        {
            id: "action",
            name: "Action",
            description: "Type: Action\n\nDescription: Executes the following blocks when this block finishes its task.",
            types: ["action"]
        },
        {
            id: "text1",
            name: "Text 1",
            description: "Type: Text\n\nDescription: The first text value to escape.",
            types: ["text", "unspecified"]
        },
        {
            id: "text2",
            name: "Text 2",
            description: "Type: Text\n\nDescription: The second text value to escape.",
            types: ["text", "unspecified"]
        },
        {
            id: "text3",
            name: "Text 3",
            description: "Type: Text\n\nDescription: The third text value to escape.",
            types: ["text", "unspecified"]
        },
        {
            id: "text4",
            name: "Text 4",
            description: "Type: Text\n\nDescription: The fourth text value to escape.",
            types: ["text", "unspecified"]
        },
        {
            id: "text5",
            name: "Text 5",
            description: "Type: Text\n\nDescription: The fifth text value to escape.",
            types: ["text", "unspecified"]
        }
    ],

    options: [],

    outputs: [
        {
            id: "action",
            name: "Action",
            description: "Type: Action\n\nDescription: Executes the following blocks when this block finishes its task.",
            types: ["action"]
        },
        {
            id: "text1",
            name: "Text 1",
            description: "The escaped first text value.",
            types: ["text"]
        },
        {
            id: "text2",
            name: "Text 2",
            description: "The escaped second text value.",
            types: ["text"]
        },
        {
            id: "text3",
            name: "Text 3",
            description: "The escaped third text value.",
            types: ["text"]
        },
        {
            id: "text4",
            name: "Text 4",
            description: "The escaped fourth text value.",
            types: ["text"]
        },
        {
            id: "text5",
            name: "Text 5",
            description: "The escaped fifth text value.",
            types: ["text"]
        }
    ],

    code(cache) {
        const escapeSqlText = (value) => {
            if (value === undefined || value === null) return "";

            return String(value).replace(/[\\'"`()%;_]/g, "\\$&");
        };

        for (let i = 1; i <= 5; i++) {
            const id = "text" + i;
            const text = this.GetInputValue(id, cache);

            this.StoreOutputValue(escapeSqlText(text), id, cache);
        }

        this.RunNextBlock("action", cache);
    }
}
