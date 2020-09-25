const functions = require('firebase-functions');
const uuid = require('uuid-random');

const admin = require('firebase-admin');
admin.initializeApp();

const db = admin.firestore();

exports.eventUpdateListener = functions
    .region('asia-northeast1')
    .firestore
    .document("events/{eventId}")
    .onUpdate( async (change, context) => {

        const data = change.after.data();
        const previousData = change.before.data();

        // Somebody has checked In
        if(data.checkedIn.length > previousData.checkedIn.length){

            let checkedBy = data.checkedIn.filter(n => !previousData.checkedIn.includes(n))

            let tokens = []
            try {
                await db.runTransaction(async (t) => {

                    const checkedByRef = db.collection("profiles").doc(checkedBy)
                    const tokensRef = db.collection("tokens").doc("fcm")

                    const checkedByDoc = await t.get(checkedByRef)
                    const tokenDoc = await t.get(tokensRef)

                    const checkedByName = capitalize(checkedByDoc.data().name)
                    const tokensData = tokenDoc.data()

                    const invitationMsg = {
                        title: `${checkedByName}`,
                        body: `has checked in at the meeting place for the event "${data.eventTitle}"`,
                        isSeen: false,
                        createdAt: new Date()
                    }

                    let notification = {}
                    notification[uuid().replace("-","")] = invitationMsg

                    // Because organizer has is not in invites
                    let invitees = data.invites.concat(data.organizer)
                    // The voter won't have to receive notification
                    invitees.removeByValue(checkedBy)

                    invitees.forEach(invite => {
                        const notificationRef = db.collection("notifications").doc(invite)
                        t.update(notificationRef, notification)
                        tokens.push(tokensData[invite])
                    })
                    sendNotification(invitationMsg, tokens)
                });

                console.log('[Check In] Transaction success!');
            } catch (e) {
                console.log('[Check In] Transaction failure:', e);
            }
        } // If bill has been added
        else if(data.bill !== previousData.bill) {

            if(data.checkedIn.length > 0) {
                let tokens = []
                try {
                    await db.runTransaction(async (t) => {

                        let billTotal = parseFloat(data.bill)
                        let totalBill = Number(billTotal).toFixed(2)
                        let perHead = billTotal / data.checkedIn.length
                        perHead = Number(perHead).toFixed(2)

                        const tokensRef = db.collection("tokens").doc("fcm")
                        const tokenDoc = await t.get(tokensRef)

                        const tokensData = tokenDoc.data()

                        const billMsg = {
                            title: `"${data.eventTitle}"'s Bill`,
                            body: `Please pay Rs. ${perHead} per head for the total bill of Rs. ${totalBill}`,
                            isSeen: false,
                            createdAt: new Date()
                        }

                        let notification = {}
                        notification[uuid().replace("-","")] = billMsg

                        data.checkedIn.forEach( person => {
                            const notificationRef = db.collection("notifications").doc(person)

                            t.update(notificationRef, notification)
                            tokens.push(tokensData[person])
                        })
                        sendNotification(billMsg, tokens)
                    });

                    console.log('[Bill Distribution] Transaction success!');
                } catch (e) {
                    console.log('[Bill Distribution] Transaction failure:', e);
                }
            } else {
                console.warn("[Bill Distribution] Checked in size is not > 0")
            }

        } else {
            let oldVoters = combineVoters(previousData.votes)
            let newVoters = combineVoters(data.votes)
            // see if voters list have been updated
            if(newVoters.length > oldVoters.length) {

                let newVoter = newVoters.filter(n => !oldVoters.includes(n))
                let tokens = []
                if(newVoter.length > 0) {
                    try {
                        await db.runTransaction(async (t) => {


                            const newVoterRef = db.collection("profiles").doc(newVoter[0])
                            const tokensRef = db.collection("tokens").doc("fcm")

                            const newVoterDoc = await t.get(newVoterRef)
                            const tokenDoc = await t.get(tokensRef)

                            const newVoterName = capitalize(newVoterDoc.data().name)
                            const tokensData = tokenDoc.data()

                            const invitationMsg = {
                                title: "Vote Casted",
                                body: `${newVoterName} has casted vote for the event "${data.eventTitle}"`,
                                isSeen: false,
                                createdAt: new Date()
                            }

                            let notification = {}
                            notification[uuid().replace("-","")] = invitationMsg

                            // Because organizer has is not in invites
                            let invitees = data.invites.concat(data.organizer)
                            // The voter won't have to receive notification
                            invitees.removeByValue(newVoter)

                            invitees.forEach(invite => {
                                const notificationRef = db.collection("notifications").doc(invite)

                                t.update(notificationRef, notification)
                                tokens.push(tokensData[invite])
                            })
                            sendNotification(invitationMsg, tokens)
                        });

                        console.log('[Cast Vote] Transaction success!');
                    } catch (e) {
                        console.log('[Cast Vote] Transaction failure:', e);
                    }
                }
            } else {
                console.error("New voter can't be derived, empty")
            }
        }

    })

/*
 * When event is created send invitation to invited people
 */

exports.eventCreateListener = functions
    .region('asia-northeast1')
    .firestore
    .document("events/{eventId}")
    .onCreate( async (snap, context) => {

        const data = snap.data()
        let tokens = []

        try {
            await db.runTransaction(async (t) => {


                const organizerRef = db.collection("profiles").doc(data.organizer)
                const tokensRef = db.collection("tokens").doc("fcm")

                const organizerDoc = await t.get(organizerRef)
                const tokenDoc = await t.get(tokensRef)

                const organizerName = capitalize(organizerDoc.data().name)
                const tokensData = tokenDoc.data()

                const invitationMsg = {
                    title: "Event Invitation",
                    body: `${organizerName} has invited to an event "${data.eventTitle}"`,
                    isSeen: false,
                    createdAt: new Date()
                }

                let notification = {}
                notification[uuid().replace("-","")] = invitationMsg

                data.invites.forEach(invite => {
                    const notificationRef = db.collection("notifications").doc(invite)
                    
                    t.update(notificationRef, notification)

                    tokens.push(tokensData[invite])
                })
                sendNotification(invitationMsg, tokens)
            });

            console.log('[Event Invitation] Transaction success!');
        } catch (e) {
            console.log('[Event Invitation] Transaction failure:', e);
        }
    })

// const manageNotification = async (data) => {
//
// }

const sendNotification = (invitationMsg, tokens) => {

    const message = {
        // data: {id: id, title: invitationMsg.title, body: invitationMsg.body},
        notification: {title: invitationMsg.title, body: invitationMsg.body},
        tokens: tokens
    }

    admin.messaging().sendMulticast(message)
        .then((response) => {
            console.log(response.successCount + ' messages were sent successfully');
        })
}

function capitalize(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

function combineVoters(items) {
    let allVoters = [];
    items.forEach(i => {
        allVoters = allVoters.concat(i.voters)
    })
    return allVoters
}

Array.prototype.removeByValue = function(val) {
    for (let i = 0; i < this.length; i++) {
        if (this[i] === val) {
            this.splice(i, 1);
            i--;
        }
    }
    return this;
}

