'use strict';

module.exports = {
    name: "Remove Item from List",
    description: "Removes an item from the list.",
    category: "List Stuff",
    inputs: [
        {
            id: "action",
            name: "Action",
            type: "ACTION",
            description: "Triggers the block."
        },
        {
            id: "list",
            name: "List",
            type: "VALUE",
            types: ["list", "unspecified"],
            description: "The list to remove an item from.",
            required: true
        },
        {
            id: "custom_position",
            name: "Custom Position",
            type: "VALUE",
            types: ["number", "unspecified"],
            description: "The zero-based position to remove when Position Type is Custom Position. The first item is position 0."
        }
    ],
    options: [
        {
            id: "position_type",
            name: "Position Type",
            description: "The position to remove the item from the list.",
            type: "SELECT",
            options: {
                first: "First Position",
                last: "Last Position",
                custom: "Custom Position"
            }
        }
    ],
    outputs: [
        {
            id: "action",
            name: "Action",
            type: "ACTION",
            description: "Triggers the next block."
        },
        {
            id: "list",
            name: "List",
            type: "VALUE",
            types: ["list"],
            description: "The list with the item removed."
        }
    ],
    code(cache) {
        const list = this.GetInputValue("list", cache);
        const positionType = this.GetOptionValue("position_type", cache, "first");

        if (list.length > 0) {
            switch (positionType) {
                case "last":
                    list.pop();
                    break;
                case "custom": {
                    const customPosition = Number(this.GetInputValue("custom_position", cache));
                    if (Number.isInteger(customPosition) && customPosition >= 0 && customPosition < list.length) {
                        list.splice(customPosition, 1);
                    }
                    break;
                }
                case "first":
                default:
                    list.shift();
                    break;
            }
        }

        this.StoreOutputValue(list, "list", cache);
        this.RunNextBlock("action", cache);
    }
};
