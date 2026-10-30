function getDateInfo(value, dateInfo, timeType) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error("Get Date Info requires a valid date");
    const utc = timeType === "utc";
    const prefix = utc ? "UTC" : "";

    switch(Number(dateInfo)) {
        case 1: return Math.trunc(date.getTime() / 1000);
        case 2: return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][date["get" + prefix + "Day"]()];
        case 3: return date["get" + prefix + "Date"]();
        case 4: return ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][date["get" + prefix + "Month"]()];
        case 5: return date["get" + prefix + "Month"]() + 1;
        case 6: return date["get" + prefix + "FullYear"]();
        case 7: return date.toLocaleDateString(undefined, { timeZone: utc ? "UTC" : undefined });
        case 8: return date.toLocaleTimeString(undefined, { timeZone: utc ? "UTC" : undefined });
        case 9: return date.toLocaleString(undefined, { timeZone: utc ? "UTC" : undefined });
        case 10: return date["get" + prefix + "Hours"]();
        case 11: return date["get" + prefix + "Minutes"]();
        case 12: return date["get" + prefix + "Seconds"]();
        case 13: return date["get" + prefix + "Milliseconds"]();
        case 14: return utc ? "UTC" : Intl.DateTimeFormat().resolvedOptions().timeZone || "Local";
        default: throw new Error("Unknown date information selection");
    }
}

module.exports = {
    name: "Get Date Info",

    description: "Gets the date information.",

    category: "Date Stuff",

    inputs: [
        {
            "id": "action",
            "name": "Action",
            "description": "Acceptable Types: Action\n\nDescription: Executes this block.",
            "types": ["action"]
        },
        {
            "id": "date",
            "name": "Date",
            "description": "Acceptable Types: Date, Unspecified\n\nDescription: The date to get the information.",
            "types": ["date", "unspecified"],
            "required": true
        }
    ],

    options: [
        {
            "id": "date_info",
            "name": "Date Info",
            "description": "Description: The date information to get.",
            "type": "SELECT",
            "options": {
                1: "Date Unix Timestamp [Number]",
                2: "Date Weekday [Text]",
                3: "Date Day Number [Number]",
                4: "Date Month of the Year [Text]",
                5: "Date Month Number [Number]",
                6: "Date Year [Number]",
                7: "Date Full Date [Text]",
                8: "Date Full Time [Text]",
                9: "Date Full Date + Full Time [Text]",
                10: "Date Hour [Number]",
                11: "Date Minute [Number]",
                12: "Date Second [Number]",
                13: "Date Millisecond [Number]",
                14: "Date Timezone [Text]"
            }
        },
        {
            "id": "time_type",
            "name": "Time Type",
            "description": "Description: The type of time to get.",
            "type": "SELECT",
            "options": {
                "local": "Local Time",
                "utc": "Universal Time (UTC)"
            }
        }
    ],

    outputs: [
        {
            "id": "action",
            "name": "Action",
            "description": "Type: Action\n\nDescription: Executes the following blocks when this block finishes its task.",
            "types": ["action"]
        },
        {
            "id": "result",
            "name": "Result",
            "description": "Type: Unspecified\n\nDescription: The information obtained from the date.",
            "types": ["unspecified"]
        }
    ],

    code(cache) {
        const date = this.GetInputValue("date", cache);
        const result = getDateInfo(date, this.GetOptionValue("date_info", cache), this.GetOptionValue("time_type", cache));

        this.StoreOutputValue(result, "result", cache);
        this.RunNextBlock("action", cache);
    },

    getDateInfo
}
